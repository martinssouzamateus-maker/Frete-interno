"""Frete Interno - apontamento de ocorrencias de entrega (EDI PROCEDA OCOREN 5.0).

Executar:  python app.py         (abre em http://0.0.0.0:8080)
"""
import configparser
import json
import os
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta
from functools import wraps
from zoneinfo import ZoneInfo

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template,
                   request, send_file, session, url_for)
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

import ocoren
import planilha

BASE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- configuracao
_ini = configparser.ConfigParser()
_ini.read(os.path.join(BASE, "config.ini"), encoding="utf-8")


# Em servidor na nuvem, DADOS_DIR aponta para o disco persistente (ex.: /var/data).
DADOS_DIR = os.environ.get("DADOS_DIR", "").strip()


def _cfg_path(chave, padrao):
    v = _ini.get("caminhos", chave, fallback="").strip()
    if not v:
        v = os.path.join(DADOS_DIR, os.path.basename(padrao)) if DADOS_DIR else padrao
    return v if os.path.isabs(v) else os.path.join(BASE, v)


DB_PATH = _cfg_path("banco", "dados/frete_interno.db")
PASTA_TXT = _cfg_path("pasta_txt", "dados/txt_ocoren")
PLANILHA = _cfg_path("planilha", "dados/apontamentos_ocoren.xlsx")
PORTA = int(os.environ.get("PORT") or _ini.getint("servidor", "porta", fallback=8080))
FUSO = ZoneInfo(os.environ.get("FUSO_HORARIO", "America/Sao_Paulo"))
for p in (os.path.dirname(DB_PATH), PASTA_TXT, os.path.dirname(PLANILHA)):
    os.makedirs(p, exist_ok=True)

with open(os.path.join(BASE, "ocorrencias.json"), encoding="utf-8") as f:
    OCORRENCIAS = json.load(f)
OCORR_MAP = {o["codigo"]: o["descricao"] for o in OCORRENCIAS}

# Ocorrencias de entrega efetivada recebem codigo de observacao 03 (como no arquivo de exemplo);
# as demais recebem 00.
COD_ENTREGUE = {"001", "002", "024", "031", "104", "105"}

CONFIG_PADRAO = {
    "remetente_nome": "CALIBRE SCIENTIFIC BRASIL LTDA.",
    "destinatario_nome": "CALIBRE SCIENTIFIC BRASIL LTDA.",
    "transportadora_cnpj": "01530501000142",
    "transportadora_nome": "CALIBRE SCIENTIFIC BRASIL LTDA. - FROTA PROPRIA",
    "emitentes": "01530501000142;CALIBRE SCIENTIFIC BRASIL LTDA.",
    "serie_nf_padrao": "2",
    "filial_cte": "",
    "serie_cte": "0",
    "favoritas": "001,098,021,046,019,006,060,079",
    "config_revisada": "0",
}

app = Flask(__name__)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=14),
    MAX_CONTENT_LENGTH=1024 * 1024,
    SESSION_COOKIE_SECURE=os.environ.get("HTTPS") == "1",
)
if os.environ.get("HTTPS") == "1":
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
_lock_encerrar = threading.Lock()


# ---------------------------------------------------------------- banco
def db():
    if "db" not in g:
        con = sqlite3.connect(DB_PATH, timeout=30)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA foreign_keys=ON")
        g.db = con
    return g.db


@app.teardown_appcontext
def _fecha_db(_exc):
    con = g.pop("db", None)
    if con is not None:
        con.close()


def agora():
    """Hora oficial de Brasilia, mesmo com o servidor em outro fuso (ex.: nuvem em UTC)."""
    return datetime.now(FUSO).replace(microsecond=0, tzinfo=None)


def iniciar_banco():
    con = sqlite3.connect(DB_PATH)
    con.executescript("""
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT UNIQUE NOT NULL COLLATE NOCASE,
        nome TEXT NOT NULL,
        senha_hash TEXT NOT NULL,
        perfil TEXT NOT NULL DEFAULT 'motorista',
        ativo INTEGER NOT NULL DEFAULT 1,
        trocar_senha INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
        encerrado_em TEXT NOT NULL,
        arquivo_txt TEXT NOT NULL,
        qtd INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apontamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_uid TEXT UNIQUE,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
        cnpj_emissor TEXT NOT NULL,
        serie_nf TEXT,
        numero_nf TEXT NOT NULL,
        cod_ocorrencia TEXT NOT NULL,
        descricao_ocorrencia TEXT NOT NULL,
        data_ocorrencia TEXT NOT NULL,
        hora_ocorrencia TEXT NOT NULL,
        cod_obs TEXT NOT NULL,
        recebedor TEXT,
        observacao TEXT,
        romaneio TEXT,
        filial_cte TEXT,
        serie_cte TEXT,
        numero_cte TEXT,
        tipo_entrega TEXT NOT NULL DEFAULT '1',
        status TEXT NOT NULL DEFAULT 'ABERTO',
        lote_id INTEGER REFERENCES lotes(id),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        excel_pendente INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS ix_ap_user ON apontamentos(usuario_id, status);
    CREATE INDEX IF NOT EXISTS ix_ap_pend ON apontamentos(excel_pendente);
    CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);
    """)
    for k, v in CONFIG_PADRAO.items():
        con.execute("INSERT OR IGNORE INTO config(chave, valor) VALUES (?,?)", (k, v))
    if not con.execute("SELECT 1 FROM config WHERE chave='secret_key'").fetchone():
        con.execute("INSERT INTO config VALUES ('secret_key', ?)", (secrets.token_hex(32),))
    if not con.execute("SELECT 1 FROM usuarios").fetchone():
        # Na internet nao usamos senha fixa: vem da variavel ADMIN_SENHA_INICIAL.
        # Rodando localmente sem a variavel, a senha inicial e "admin" (troca obrigatoria no 1o acesso).
        senha_ini = os.environ.get("ADMIN_SENHA_INICIAL") or "admin"
        con.execute(
            "INSERT INTO usuarios(login,nome,senha_hash,perfil,trocar_senha,criado_em) VALUES (?,?,?,?,1,?)",
            ("admin", "Administrador", generate_password_hash(senha_ini), "admin", agora().isoformat()))
    con.commit()
    app.secret_key = con.execute("SELECT valor FROM config WHERE chave='secret_key'").fetchone()[0]
    con.close()


def cfg():
    return {r["chave"]: r["valor"] for r in db().execute("SELECT chave, valor FROM config")}


def emitentes(c=None):
    c = c or cfg()
    out = []
    for ln in (c.get("emitentes") or "").splitlines():
        if not ln.strip():
            continue
        cnpj, _, nome = ln.partition(";")
        cnpj = ocoren.so_digitos(cnpj)
        if len(cnpj) == 14:
            out.append({"cnpj": cnpj, "nome": nome.strip() or cnpj})
    return out


# ---------------------------------------------------------------- autenticacao
def usuario_atual():
    uid = session.get("uid")
    if not uid:
        return None
    if "usuario" not in g:
        g.usuario = db().execute("SELECT * FROM usuarios WHERE id=? AND ativo=1", (uid,)).fetchone()
    return g.usuario


def login_obrigatorio(admin=False):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            u = usuario_atual()
            api = request.path.startswith("/api/")
            if not u:
                session.clear()
                return (jsonify(erro="Sessão expirada. Entre novamente."), 401) if api \
                    else redirect(url_for("login", proximo=request.path))
            if u["trocar_senha"] and request.endpoint not in ("trocar_senha", "logout"):
                return (jsonify(erro="Troque sua senha."), 403) if api else redirect(url_for("trocar_senha"))
            if admin and u["perfil"] != "admin":
                abort(403)
            return fn(*a, **kw)
        return wrapper
    return deco


@app.before_request
def _csrf():
    if request.method in ("POST", "PUT", "DELETE"):
        if request.endpoint == "login":
            return
        tok = request.headers.get("X-CSRF-Token") or request.form.get("csrf")
        if not tok or tok != session.get("csrf"):
            if request.path.startswith("/api/"):
                return jsonify(erro="Sessão inválida. Recarregue a página."), 400
            abort(400)


@app.context_processor
def _ctx():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(24)
    return {"csrf": session["csrf"], "usuario": usuario_atual()}


_falhas = {}  # (ip, login) -> [tentativas, bloqueado_ate]
_lock_falhas = threading.Lock()
MAX_TENTATIVAS, BLOQUEIO_MIN = 5, 10


@app.route("/login", methods=["GET", "POST"])
def login():
    erro = None
    if request.method == "POST":
        login_ = (request.form.get("login") or "").strip()
        senha = request.form.get("senha") or ""
        chave = (request.remote_addr, login_.lower())
        with _lock_falhas:
            n, ate = _falhas.get(chave, (0, None))
            if ate and ate > datetime.now():
                return render_template("login.html", erro="Muitas tentativas erradas. Aguarde %d minutos e tente de novo." % BLOQUEIO_MIN), 429
        u = db().execute("SELECT * FROM usuarios WHERE login=?", (login_,)).fetchone()
        if u and u["ativo"] and check_password_hash(u["senha_hash"], senha):
            with _lock_falhas:
                _falhas.pop(chave, None)
            session.clear()
            session.permanent = True
            session["uid"] = u["id"]
            session["csrf"] = secrets.token_urlsafe(24)
            if u["trocar_senha"]:
                return redirect(url_for("trocar_senha"))
            prox = request.args.get("proximo") or ""
            if prox.startswith("/") and not prox.startswith("//"):
                return redirect(prox)
            return redirect(url_for("inicio"))
        with _lock_falhas:
            n = _falhas.get(chave, (0, None))[0] + 1
            _falhas[chave] = (0, datetime.now() + timedelta(minutes=BLOQUEIO_MIN)) if n >= MAX_TENTATIVAS else (n, None)
        erro = "Usuário ou senha inválidos."
    return render_template("login.html", erro=erro)


@app.route("/sair")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/trocar-senha", methods=["GET", "POST"])
@login_obrigatorio()
def trocar_senha():
    u = usuario_atual()
    erro = None
    if request.method == "POST":
        atual = request.form.get("atual") or ""
        nova = request.form.get("nova") or ""
        conf = request.form.get("confirmacao") or ""
        if not check_password_hash(u["senha_hash"], atual):
            erro = "Senha atual incorreta."
        elif len(nova) < 6:
            erro = "A nova senha precisa ter pelo menos 6 caracteres."
        elif nova != conf:
            erro = "A confirmação não confere."
        elif nova == atual:
            erro = "A nova senha deve ser diferente da atual."
        else:
            db().execute("UPDATE usuarios SET senha_hash=?, trocar_senha=0 WHERE id=?",
                         (generate_password_hash(nova), u["id"]))
            db().commit()
            flash("Senha alterada.")
            return redirect(url_for("inicio"))
    return render_template("trocar_senha.html", erro=erro, obrigatoria=bool(u["trocar_senha"]))


@app.route("/")
@login_obrigatorio()
def inicio():
    return redirect(url_for("apontamento"))


# ---------------------------------------------------------------- tela do motorista
@app.route("/apontamento")
@login_obrigatorio()
def apontamento():
    c = cfg()
    fav = [x.strip().zfill(3) for x in (c.get("favoritas") or "").split(",") if x.strip()]
    lotes = db().execute(
        "SELECT * FROM lotes WHERE usuario_id=? ORDER BY id DESC LIMIT 15", (usuario_atual()["id"],)).fetchall()
    return render_template(
        "apontamento.html",
        ocorrencias=OCORRENCIAS, favoritas=[f for f in fav if f in OCORR_MAP],
        emitentes=emitentes(c), serie_padrao=c.get("serie_nf_padrao", ""),
        filial_cte=c.get("filial_cte", ""), serie_cte=c.get("serie_cte", "0"),
        lotes=lotes, hoje=agora().strftime("%Y-%m-%d"))


def _registro_json(r):
    return {k: r[k] for k in r.keys() if k not in ("excel_pendente",)}


def _sincronizar_planilha():
    rows = db().execute("""
        SELECT a.*, u.nome AS motorista_nome, u.login AS usuario_login, l.arquivo_txt, l.encerrado_em
        FROM apontamentos a JOIN usuarios u ON u.id=a.usuario_id
        LEFT JOIN lotes l ON l.id=a.lote_id
        WHERE a.excel_pendente=1 ORDER BY a.id""").fetchall()
    if not rows:
        return True, "ok"
    ok, msg = planilha.sincronizar(PLANILHA, rows)
    if ok:
        db().executemany("UPDATE apontamentos SET excel_pendente=0 WHERE id=? AND atualizado_em=?",
                         [(r["id"], r["atualizado_em"]) for r in rows])
        db().commit()
    else:
        app.logger.warning(msg)
    return ok, msg


def _validar(dados):
    c = cfg()
    erros = []
    nf = ocoren.so_digitos(dados.get("numero_nf"))
    if not nf or len(nf) > 9 or int(nf) == 0:
        erros.append("Informe o número da NF (até 9 dígitos).")
    cod = (dados.get("cod_ocorrencia") or "").zfill(3)
    if cod not in OCORR_MAP:
        erros.append("Selecione a ocorrência na lista.")
    try:
        d = datetime.strptime(dados.get("data_ocorrencia") or "", "%Y-%m-%d")
        if d.date() > (agora() + timedelta(days=1)).date():
            erros.append("A data da ocorrência não pode ser futura.")
    except ValueError:
        erros.append("Selecione a data da ocorrência.")
    hora = dados.get("hora_ocorrencia") or ""
    try:
        datetime.strptime(hora[:5], "%H:%M")
    except ValueError:
        erros.append("Selecione o horário da ocorrência.")
    emits = emitentes(c)
    cnpj = ocoren.so_digitos(dados.get("cnpj_emissor")) or (emits[0]["cnpj"] if emits else "")
    if len(cnpj) != 14:
        erros.append("CNPJ do emissor da NF inválido (verifique as configurações).")
    if erros:
        return None, erros
    return {
        "cnpj_emissor": cnpj,
        "serie_nf": (dados.get("serie_nf") or c.get("serie_nf_padrao") or "").strip()[:3],
        "numero_nf": nf.zfill(9),
        "cod_ocorrencia": cod,
        "descricao_ocorrencia": OCORR_MAP[cod],
        "data_ocorrencia": dados["data_ocorrencia"],
        "hora_ocorrencia": hora[:5],
        "cod_obs": "03" if cod in COD_ENTREGUE else "00",
        "recebedor": (dados.get("recebedor") or "").strip()[:60],
        "observacao": (dados.get("observacao") or "").strip()[:120],
        "romaneio": (dados.get("romaneio") or "").strip()[:20],
        "filial_cte": (dados.get("filial_cte") or c.get("filial_cte") or "").strip()[:10],
        "serie_cte": ocoren.so_digitos(dados.get("serie_cte") or c.get("serie_cte") or "0")[:5] or "0",
        "numero_cte": ocoren.so_digitos(dados.get("numero_cte"))[:12],
    }, None


@app.route("/api/abertos")
@login_obrigatorio()
def api_abertos():
    rows = db().execute("SELECT * FROM apontamentos WHERE usuario_id=? AND status='ABERTO' ORDER BY id DESC",
                        (usuario_atual()["id"],)).fetchall()
    pend = db().execute("SELECT COUNT(*) FROM apontamentos WHERE excel_pendente=1").fetchone()[0]
    return jsonify(registros=[_registro_json(r) for r in rows], planilha_pendente=pend)


@app.route("/api/apontamentos", methods=["POST"])
@login_obrigatorio()
def api_criar():
    dados = request.get_json(silent=True) or {}
    uid_cli = (dados.get("client_uid") or "")[:64] or None
    if uid_cli:
        ja = db().execute("SELECT * FROM apontamentos WHERE client_uid=?", (uid_cli,)).fetchone()
        if ja:
            return jsonify(registro=_registro_json(ja), repetido=True)
    v, erros = _validar(dados)
    if erros:
        return jsonify(erro=" ".join(erros)), 422
    u = usuario_atual()
    aviso = None
    dup = db().execute(
        "SELECT id FROM apontamentos WHERE usuario_id=? AND status='ABERTO' AND numero_nf=? AND cod_ocorrencia=? AND cnpj_emissor=?",
        (u["id"], v["numero_nf"], v["cod_ocorrencia"], v["cnpj_emissor"])).fetchone()
    if dup:
        aviso = "Atenção: esta NF já tem a mesma ocorrência neste apontamento."
    ts = agora().isoformat()
    cur = db().execute("""INSERT INTO apontamentos
        (client_uid, usuario_id, cnpj_emissor, serie_nf, numero_nf, cod_ocorrencia, descricao_ocorrencia,
         data_ocorrencia, hora_ocorrencia, cod_obs, recebedor, observacao, romaneio, filial_cte, serie_cte,
         numero_cte, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (uid_cli, u["id"], v["cnpj_emissor"], v["serie_nf"], v["numero_nf"], v["cod_ocorrencia"],
         v["descricao_ocorrencia"], v["data_ocorrencia"], v["hora_ocorrencia"], v["cod_obs"], v["recebedor"],
         v["observacao"], v["romaneio"], v["filial_cte"], v["serie_cte"], v["numero_cte"], ts, ts))
    db().commit()
    _sincronizar_planilha()
    r = db().execute("SELECT * FROM apontamentos WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(registro=_registro_json(r), aviso=aviso), 201


def _meu_aberto(rid):
    r = db().execute("SELECT * FROM apontamentos WHERE id=? AND usuario_id=?", (rid, usuario_atual()["id"])).fetchone()
    if not r:
        abort(404)
    if r["status"] != "ABERTO":
        return None
    return r


@app.route("/api/apontamentos/<int:rid>", methods=["PUT"])
@login_obrigatorio()
def api_editar(rid):
    r = _meu_aberto(rid)
    if r is None:
        return jsonify(erro="Este apontamento já foi encerrado e não pode ser alterado."), 409
    v, erros = _validar(request.get_json(silent=True) or {})
    if erros:
        return jsonify(erro=" ".join(erros)), 422
    v["atualizado_em"] = agora().isoformat()
    sets = ", ".join("%s=?" % k for k in v)
    db().execute("UPDATE apontamentos SET %s, excel_pendente=1 WHERE id=?" % sets, (*v.values(), rid))
    db().commit()
    _sincronizar_planilha()
    r = db().execute("SELECT * FROM apontamentos WHERE id=?", (rid,)).fetchone()
    return jsonify(registro=_registro_json(r))


@app.route("/api/apontamentos/<int:rid>", methods=["DELETE"])
@login_obrigatorio()
def api_excluir(rid):
    r = _meu_aberto(rid)
    if r is None:
        return jsonify(erro="Este apontamento já foi encerrado."), 409
    db().execute("UPDATE apontamentos SET status='EXCLUIDO', atualizado_em=?, excel_pendente=1 WHERE id=?",
                  (agora().isoformat(), rid))
    db().commit()
    _sincronizar_planilha()
    return jsonify(ok=True)


@app.route("/api/encerrar", methods=["POST"])
@login_obrigatorio()
def api_encerrar():
    u = usuario_atual()
    with _lock_encerrar:
        con = db()
        rows = con.execute(
            "SELECT * FROM apontamentos WHERE usuario_id=? AND status='ABERTO' ORDER BY data_ocorrencia, hora_ocorrencia, id",
            (u["id"],)).fetchall()
        if not rows:
            return jsonify(erro="Não há notas para encerrar."), 400
        c = cfg()
        ts = agora()
        seq_dia = con.execute("SELECT COUNT(*) FROM lotes WHERE substr(encerrado_em,1,10)=?",
                              (ts.strftime("%Y-%m-%d"),)).fetchone()[0] + 1
        cur = con.execute("INSERT INTO lotes(usuario_id, encerrado_em, arquivo_txt, qtd) VALUES (?,?,?,?)",
                          (u["id"], ts.isoformat(), "", len(rows)))
        lote_id = cur.lastrowid
        nome = ocoren.nome_arquivo(ts, lote_id)
        while os.path.exists(os.path.join(PASTA_TXT, nome)):  # nunca sobrescreve
            lote_id_alt = int(ocoren.so_digitos(nome.split("_")[2])) + 1
            nome = ocoren.nome_arquivo(ts, lote_id_alt)
        conteudo = ocoren.gerar_ocoren([dict(r) for r in rows], c, ts, seq_dia % 1000 or 1)
        caminho = os.path.join(PASTA_TXT, nome)
        try:
            with open(caminho, "w", encoding="ascii", newline="") as f:
                f.write(conteudo)
        except OSError as e:
            con.rollback()
            return jsonify(erro="Não foi possível gravar o TXT: %s" % e), 500
        con.execute("UPDATE lotes SET arquivo_txt=? WHERE id=?", (nome, lote_id))
        con.executemany("UPDATE apontamentos SET status='ENCERRADO', lote_id=?, atualizado_em=?, excel_pendente=1 WHERE id=?",
                        [(lote_id, ts.isoformat(), r["id"]) for r in rows])
        con.commit()
    ok, msg = _sincronizar_planilha()
    return jsonify(ok=True, lote=lote_id, arquivo=nome, qtd=len(rows),
                   download=url_for("baixar_txt", lote_id=lote_id),
                   aviso=None if ok else msg)


@app.route("/txt/<int:lote_id>")
@login_obrigatorio()
def baixar_txt(lote_id):
    u = usuario_atual()
    l = db().execute("SELECT * FROM lotes WHERE id=?", (lote_id,)).fetchone()
    if not l or (u["perfil"] != "admin" and l["usuario_id"] != u["id"]):
        abort(404)
    caminho = os.path.join(PASTA_TXT, l["arquivo_txt"])
    if not os.path.exists(caminho):
        abort(404)
    return send_file(caminho, as_attachment=True, download_name=l["arquivo_txt"], mimetype="text/plain")


# ---------------------------------------------------------------- administracao
@app.route("/admin")
@login_obrigatorio(admin=True)
def admin():
    con = db()
    lotes = con.execute("""SELECT l.*, u.nome FROM lotes l JOIN usuarios u ON u.id=l.usuario_id
                           ORDER BY l.id DESC LIMIT 300""").fetchall()
    usuarios = con.execute("""SELECT u.*, (SELECT COUNT(*) FROM apontamentos a WHERE a.usuario_id=u.id AND a.status='ABERTO') AS abertos
                              FROM usuarios u ORDER BY u.ativo DESC, u.nome""").fetchall()
    abertos = con.execute("""SELECT a.*, u.nome FROM apontamentos a JOIN usuarios u ON u.id=a.usuario_id
                             WHERE a.status='ABERTO' ORDER BY u.nome, a.id""").fetchall()
    pend = con.execute("SELECT COUNT(*) FROM apontamentos WHERE excel_pendente=1").fetchone()[0]
    stats = con.execute("""SELECT COUNT(*) t, SUM(cod_ocorrencia IN ('001','002','024','031','104','105')) e
                           FROM apontamentos WHERE status='ENCERRADO' AND substr(criado_em,1,10)=?""",
                        (agora().strftime("%Y-%m-%d"),)).fetchone()
    return render_template("admin.html", lotes=lotes, usuarios=usuarios, abertos=abertos, c=cfg(),
                           pendentes=pend, stats=stats, aba=request.args.get("aba", "lotes"),
                           pasta_txt=PASTA_TXT, planilha=PLANILHA)


@app.route("/admin/planilha")
@login_obrigatorio(admin=True)
def admin_planilha():
    _sincronizar_planilha()
    if not os.path.exists(PLANILHA):
        flash("A planilha ainda não foi criada (nenhum apontamento).")
        return redirect(url_for("admin"))
    return send_file(PLANILHA, as_attachment=True, download_name=os.path.basename(PLANILHA))


@app.route("/admin/sincronizar", methods=["POST"])
@login_obrigatorio(admin=True)
def admin_sincronizar():
    ok, msg = _sincronizar_planilha()
    flash("Planilha atualizada." if ok else msg)
    return redirect(url_for("admin"))


@app.route("/admin/usuarios", methods=["POST"])
@login_obrigatorio(admin=True)
def admin_usuario_novo():
    login_ = (request.form.get("login") or "").strip().lower()
    nome = (request.form.get("nome") or "").strip()
    senha = request.form.get("senha") or ""
    perfil = "admin" if request.form.get("perfil") == "admin" else "motorista"
    if not login_ or not nome or len(senha) < 4:
        flash("Preencha nome, usuário e uma senha inicial com pelo menos 4 caracteres.")
    elif db().execute("SELECT 1 FROM usuarios WHERE login=?", (login_,)).fetchone():
        flash("Já existe um usuário com o login '%s'." % login_)
    else:
        db().execute("INSERT INTO usuarios(login,nome,senha_hash,perfil,trocar_senha,criado_em) VALUES (?,?,?,?,1,?)",
                     (login_, nome, generate_password_hash(senha), perfil, agora().isoformat()))
        db().commit()
        flash("Usuário %s criado. No primeiro acesso ele deverá trocar a senha." % login_)
    return redirect(url_for("admin", aba="usuarios"))


@app.route("/admin/usuarios/<int:uid>", methods=["POST"])
@login_obrigatorio(admin=True)
def admin_usuario_acao(uid):
    acao = request.form.get("acao")
    u = db().execute("SELECT * FROM usuarios WHERE id=?", (uid,)).fetchone()
    if not u:
        abort(404)
    if acao == "senha":
        senha = request.form.get("senha") or ""
        if len(senha) < 4:
            flash("Senha muito curta.")
        else:
            db().execute("UPDATE usuarios SET senha_hash=?, trocar_senha=1 WHERE id=?",
                         (generate_password_hash(senha), uid))
            flash("Senha de %s redefinida." % u["login"])
    elif acao == "ativo":
        if uid == usuario_atual()["id"]:
            flash("Você não pode desativar o próprio usuário.")
        else:
            db().execute("UPDATE usuarios SET ativo=1-ativo WHERE id=?", (uid,))
            flash("Usuário %s %s." % (u["login"], "desativado" if u["ativo"] else "reativado"))
    db().commit()
    return redirect(url_for("admin", aba="usuarios"))


@app.route("/admin/config", methods=["POST"])
@login_obrigatorio(admin=True)
def admin_config():
    f = request.form
    erros = []
    cnpj = ocoren.so_digitos(f.get("transportadora_cnpj"))
    if len(cnpj) != 14:
        erros.append("CNPJ da transportadora deve ter 14 dígitos.")
    linhas = []
    for ln in (f.get("emitentes") or "").splitlines():
        if not ln.strip():
            continue
        c, _, n = ln.partition(";")
        c = ocoren.so_digitos(c)
        if len(c) != 14:
            erros.append("CNPJ emissor inválido: %s" % ln.strip())
        linhas.append("%s;%s" % (c, n.strip()))
    if not linhas:
        erros.append("Informe ao menos um CNPJ emissor de NF.")
    if erros:
        flash(" ".join(erros))
        return redirect(url_for("admin", aba="config"))
    novos = {
        "remetente_nome": f.get("remetente_nome", "").strip()[:35],
        "destinatario_nome": f.get("destinatario_nome", "").strip()[:35],
        "transportadora_cnpj": cnpj,
        "transportadora_nome": f.get("transportadora_nome", "").strip()[:50],
        "emitentes": "\n".join(linhas),
        "serie_nf_padrao": f.get("serie_nf_padrao", "").strip()[:3],
        "filial_cte": f.get("filial_cte", "").strip()[:10],
        "serie_cte": ocoren.so_digitos(f.get("serie_cte"))[:5] or "0",
        "favoritas": ",".join(x.strip().zfill(3) for x in (f.get("favoritas") or "").split(",") if x.strip()),
        "config_revisada": "1",
    }
    db().executemany("INSERT OR REPLACE INTO config(chave, valor) VALUES (?,?)", novos.items())
    db().commit()
    flash("Configurações salvas.")
    return redirect(url_for("admin", aba="config"))


@app.errorhandler(403)
def _403(_e):
    return render_template("erro.html", msg="Acesso restrito ao administrador."), 403


@app.errorhandler(404)
def _404(_e):
    if request.path.startswith("/api/"):
        return jsonify(erro="Registro não encontrado."), 404
    return render_template("erro.html", msg="Página não encontrada."), 404


iniciar_banco()

if __name__ == "__main__":
    try:
        from waitress import serve
        print("Frete Interno rodando em http://0.0.0.0:%d  (Ctrl+C para parar)" % PORTA)
        serve(app, host="0.0.0.0", port=PORTA, threads=8)
    except ImportError:
        print("Aviso: 'waitress' não instalado; usando servidor interno do Flask.")
        app.run(host="0.0.0.0", port=PORTA, threaded=True)

