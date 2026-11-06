/**
 * FRETE INTERNO - Apontamento de ocorrências de entrega (EDI PROCEDA OCOREN 5.0)
 * Versão Google Apps Script: gratuita, sem servidor próprio.
 *
 *  - Planilha Google (esta planilha) = banco de dados + planilha de apontamentos.
 *  - Pasta no Google Drive "Frete Interno - TXT OCOREN" = arquivos TXT gerados.
 *
 * Instalação: veja o arquivo LEIA-ME. Resumo:
 *  1. Crie uma Planilha Google > Extensões > Apps Script.
 *  2. Cole este arquivo (Codigo.gs) e crie o arquivo HTML "Index".
 *  3. Troque SENHA_INICIAL_ADMIN abaixo, selecione a função "configurar" e clique em Executar.
 *  4. Implantar > Nova implantação > App da Web (Executar como: Eu / Acesso: Qualquer pessoa).
 *
 * Atenção: funções cujo nome termina com "_" são internas. As demais podem ser chamadas pela página.
 */

var SENHA_INICIAL_ADMIN = 'troque-esta-senha';   // usada só na primeira configuração (troca obrigatória no 1º acesso)
var FUSO = 'America/Sao_Paulo';
var SESSAO_HORAS = 14;
var MAX_TENTATIVAS = 5, BLOQUEIO_MIN = 10;
var COD_ENTREGUE = ['001', '002', '024', '031', '104', '105'];   // recebem código de observação 03; demais 00

var ABA_AP = 'Apontamentos', ABA_LOTES = 'Lotes', ABA_US = 'Usuarios', ABA_CFG = 'Config', ABA_OC = 'Ocorrencias';
var COLS_AP = ['ID', 'Registrado em', 'Motorista', 'Usuário', 'Nota Fiscal', 'Série NF', 'CNPJ emissor NF',
  'Cód. ocorrência', 'Descrição da ocorrência', 'Data ocorrência', 'Hora ocorrência', 'Recebedor', 'Observação',
  'Romaneio', 'Filial CT-e', 'Série CT-e', 'Nº CT-e', 'Cód. obs.', 'Lote', 'Status', 'Arquivo TXT',
  'Encerrado em', 'Última alteração', 'ID usuário', 'Chave de envio'];
var COLS_LOTES = ['Lote', 'Encerrado em', 'ID usuário', 'Motorista', 'Qtd NFs', 'Arquivo TXT', 'Link do arquivo'];
var COLS_US = ['ID', 'Usuário', 'Nome', 'Perfil', 'Ativo', 'Trocar senha', 'Sal', 'Hash da senha', 'Criado em'];

var CONFIG_PADRAO = {
  remetente_nome: 'CALIBRE SCIENTIFIC BRASIL LTDA.',
  destinatario_nome: 'CALIBRE SCIENTIFIC BRASIL LTDA.',
  transportadora_cnpj: '01530501000142',
  transportadora_nome: 'CALIBRE SCIENTIFIC BRASIL LTDA. - FROTA PROPRIA',
  emitentes: '01530501000142;CALIBRE SCIENTIFIC BRASIL LTDA.',
  serie_nf_padrao: '2',
  filial_cte: '',
  serie_cte: '0',
  favoritas: '001,098,021,046,019,006,060,079',
  config_revisada: '0'
};

/* =====================================================================================
 * PÁGINA
 * ===================================================================================== */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Frete Interno · Calibre')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Frete Interno')
      .addItem('Configurar / verificar', 'configurar')
      .addToUi();
  } catch (e) { /* sem interface (ex.: execução pelo app da web) */ }
}

/* =====================================================================================
 * CONFIGURAÇÃO INICIAL (executar uma vez pelo editor)
 * ===================================================================================== */
function configurar() {
  var props = PropertiesService.getScriptProperties();
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { }
  if (!ss && props.getProperty('PLANILHA_ID')) ss = SpreadsheetApp.openById(props.getProperty('PLANILHA_ID'));
  if (!ss) ss = SpreadsheetApp.create('Frete Interno - Apontamentos OCOREN');
  props.setProperty('PLANILHA_ID', ss.getId());

  aba_(ss, ABA_AP, COLS_AP, [8, 16, 22, 12, 13, 9, 18, 11, 42, 13, 10, 24, 34, 13, 11, 10, 14, 9, 7, 12, 34, 16, 16, 10, 16]);
  aba_(ss, ABA_LOTES, COLS_LOTES, [7, 16, 10, 24, 9, 36, 50]);
  var us = aba_(ss, ABA_US, COLS_US, [6, 14, 26, 12, 8, 12, 20, 40, 16]);
  var cfg = aba_(ss, ABA_CFG, ['Chave', 'Valor'], [24, 70]);
  var oc = aba_(ss, ABA_OC, ['Código', 'Descrição'], [10, 70]);

  if (oc.getLastRow() < 2) {
    oc.getRange(2, 1, OCORRENCIAS_PADRAO.length, 2).setValues(OCORRENCIAS_PADRAO);
  }
  var atuais = lerConfig_(ss);
  var novos = [];
  Object.keys(CONFIG_PADRAO).forEach(function (k) { if (!(k in atuais)) novos.push([k, CONFIG_PADRAO[k]]); });
  if (novos.length) cfg.getRange(cfg.getLastRow() + 1, 1, novos.length, 2).setValues(novos);

  if (us.getLastRow() < 2) {
    var sal = Utilities.getUuid();
    us.appendRow(['1', 'admin', 'Administrador', 'admin', 'SIM', 'SIM', sal, hash_(SENHA_INICIAL_ADMIN, sal), agoraTxt_()]);
  }

  if (!props.getProperty('PASTA_ID')) {
    var pasta = DriveApp.createFolder('Frete Interno - TXT OCOREN');
    props.setProperty('PASTA_ID', pasta.getId());
  }
  try { ss.setSpreadsheetTimeZone(FUSO); } catch (e) { }
  var msg = 'Configuração concluída. Agora publique em Implantar > Nova implantação > App da Web.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}

function aba_(ss, nome, colunas, larguras) {
  var sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome);
    sh.getRange(1, 1, 1, colunas.length).setValues([colunas])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#E60B85').setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), colunas.length).setNumberFormat('@');   // tudo como texto: preserva zeros à esquerda
    (larguras || []).forEach(function (w, i) { sh.setColumnWidth(i + 1, w * 7 + 10); });
  }
  return sh;
}

/* =====================================================================================
 * UTILITÁRIOS
 * ===================================================================================== */
function planilha_() {
  var id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID');
  if (!id) throw new Error('Sistema não configurado. Execute a função "configurar" no editor do Apps Script.');
  return SpreadsheetApp.openById(id);
}
function agora_() { return new Date(); }
function fmt_(d, p) { return Utilities.formatDate(d, FUSO, p); }
function agoraTxt_() { return fmt_(agora_(), 'dd/MM/yyyy HH:mm'); }
function digitos_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function txt_(v) {
  if (v instanceof Date) return fmt_(v, 'dd/MM/yyyy');
  return v == null ? '' : String(v);
}
function isoParaBr_(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
function brParaIso_(br) {
  br = txt_(br);
  var m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : br;
}
function hash_(senha, sal) {
  var h = senha + '|' + sal;
  for (var i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + sal, Utilities.Charset.UTF_8));
  }
  return h;
}
function lerConfig_(ss) {
  var sh = (ss || planilha_()).getSheetByName(ABA_CFG), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) out[String(r[0])] = txt_(r[1]); });
  return out;
}
function salvarConfig_(novos) {
  var sh = planilha_().getSheetByName(ABA_CFG);
  var n = Math.max(sh.getLastRow() - 1, 0);
  var vals = n ? sh.getRange(2, 1, n, 2).getValues() : [];
  Object.keys(novos).forEach(function (k) {
    var achou = false;
    for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === k) { vals[i][1] = novos[k]; achou = true; }
    if (!achou) vals.push([k, novos[k]]);
  });
  sh.getRange(2, 1, vals.length, 2).setValues(vals);
}
function ocorrencias_() {
  var sh = planilha_().getSheetByName(ABA_OC);
  return sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues()
    .filter(function (r) { return r[0] !== '' && r[0] != null; })
    .map(function (r) { return { codigo: ('000' + digitos_(r[0])).slice(-3), descricao: txt_(r[1]).trim() }; });
}
function emitentes_(c) {
  return (c.emitentes || '').split(/\r?\n/).map(function (l) {
    var p = l.split(';'), cnpj = digitos_(p[0]);
    return cnpj.length === 14 ? { cnpj: cnpj, nome: (p.slice(1).join(';') || cnpj).trim() } : null;
  }).filter(Boolean);
}
function comTrava_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* =====================================================================================
 * USUÁRIOS E SESSÃO
 * ===================================================================================== */
function usuarios_() {
  var sh = planilha_().getSheetByName(ABA_US);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, COLS_US.length).getValues().map(function (r, i) {
    return { linha: i + 2, id: txt_(r[0]), login: txt_(r[1]).toLowerCase(), nome: txt_(r[2]), perfil: txt_(r[3]),
      ativo: txt_(r[4]) === 'SIM', trocar_senha: txt_(r[5]) === 'SIM', sal: txt_(r[6]), hash: txt_(r[7]) };
  });
}
function publico_(u) { return { id: u.id, login: u.login, nome: u.nome, perfil: u.perfil, trocar_senha: u.trocar_senha }; }

function sessao_(token, exigeAdmin) {
  if (!token || typeof token !== 'string') throw new Error('SESSAO');
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('sess_' + token);
  if (!raw) throw new Error('SESSAO');
  var s = JSON.parse(raw);
  if (s.exp < Date.now()) { props.deleteProperty('sess_' + token); throw new Error('SESSAO'); }
  var u = usuarios_().filter(function (x) { return x.id === s.uid && x.ativo; })[0];
  if (!u) throw new Error('SESSAO');
  if (exigeAdmin && u.perfil !== 'admin') throw new Error('Acesso restrito ao administrador.');
  return u;
}

/** Envolve as funções públicas: transforma exceções em {erro} e sessão expirada em {sessao:false}. */
function resp_(fn) {
  try { return fn(); } catch (e) {
    if (e && e.message === 'SESSAO') return { sessao: false, erro: 'Sessão expirada. Entre novamente.' };
    return { erro: (e && e.message) || String(e) };
  }
}

function login(login, senha) {
  return resp_(function () {
    login = String(login || '').trim().toLowerCase();
    var cache = CacheService.getScriptCache(), chave = 'falha_' + login;
    var falhas = Number(cache.get(chave) || 0);
    if (falhas >= MAX_TENTATIVAS) return { erro: 'Muitas tentativas erradas. Aguarde ' + BLOQUEIO_MIN + ' minutos e tente de novo.' };
    var u = usuarios_().filter(function (x) { return x.login === login; })[0];
    if (!u || !u.ativo || hash_(String(senha || ''), u.sal) !== u.hash) {
      cache.put(chave, String(falhas + 1), BLOQUEIO_MIN * 60);
      return { erro: 'Usuário ou senha inválidos.' };
    }
    cache.remove(chave);
    var props = PropertiesService.getScriptProperties();
    // limpa sessões vencidas
    var todas = props.getProperties(), agora = Date.now();
    Object.keys(todas).forEach(function (k) {
      if (k.indexOf('sess_') === 0) { try { if (JSON.parse(todas[k]).exp < agora) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); } }
    });
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('sess_' + token, JSON.stringify({ uid: u.id, exp: agora + SESSAO_HORAS * 3600 * 1000 }));
    return { token: token, usuario: publico_(u) };
  });
}

function sair(token) {
  try { PropertiesService.getScriptProperties().deleteProperty('sess_' + token); } catch (e) { }
  return { ok: true };
}

function trocarSenha(token, atual, nova, confirmacao) {
  return resp_(function () {
    var u = sessao_(token);
    if (hash_(String(atual || ''), u.sal) !== u.hash) return { erro: 'Senha atual incorreta.' };
    if (String(nova || '').length < 6) return { erro: 'A nova senha precisa ter pelo menos 6 caracteres.' };
    if (nova !== confirmacao) return { erro: 'A confirmação não confere.' };
    if (nova === atual) return { erro: 'A nova senha deve ser diferente da atual.' };
    var sal = Utilities.getUuid();
    comTrava_(function () {
      planilha_().getSheetByName(ABA_US).getRange(u.linha, 6, 1, 3).setValues([['NAO', sal, hash_(nova, sal)]]);
    });
    u.trocar_senha = false;
    return { ok: true, usuario: publico_(u) };
  });
}

/* =====================================================================================
 * APONTAMENTOS
 * ===================================================================================== */
function apontamentos_() {
  var sh = planilha_().getSheetByName(ABA_AP);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, COLS_AP.length).getValues().map(function (r, i) {
    return {
      linha: i + 2, id: Number(txt_(r[0])) || 0, criado_em: txt_(r[1]), motorista: txt_(r[2]), usuario_login: txt_(r[3]),
      numero_nf: txt_(r[4]), serie_nf: txt_(r[5]), cnpj_emissor: txt_(r[6]), cod_ocorrencia: txt_(r[7]),
      descricao_ocorrencia: txt_(r[8]), data_ocorrencia: brParaIso_(r[9]), hora_ocorrencia: txt_(r[10]).slice(0, 5),
      recebedor: txt_(r[11]), observacao: txt_(r[12]), romaneio: txt_(r[13]), filial_cte: txt_(r[14]),
      serie_cte: txt_(r[15]), numero_cte: txt_(r[16]), cod_obs: txt_(r[17]), lote_id: txt_(r[18]),
      status: txt_(r[19]), arquivo_txt: txt_(r[20]), encerrado_em: txt_(r[21]), atualizado_em: txt_(r[22]),
      usuario_id: txt_(r[23]), client_uid: txt_(r[24])
    };
  }).filter(function (a) { return a.id; });
}
function linhaAp_(a) {
  return [String(a.id), a.criado_em, a.motorista, a.usuario_login, a.numero_nf, a.serie_nf, a.cnpj_emissor,
    a.cod_ocorrencia, a.descricao_ocorrencia, isoParaBr_(a.data_ocorrencia), a.hora_ocorrencia, a.recebedor,
    a.observacao, a.romaneio, a.filial_cte, a.serie_cte, a.numero_cte, a.cod_obs, a.lote_id ? String(a.lote_id) : '',
    a.status, a.arquivo_txt || '', a.encerrado_em || '', a.atualizado_em, a.usuario_id, a.client_uid || ''];
}
function gravarAp_(a) {
  var sh = planilha_().getSheetByName(ABA_AP);
  if (a.linha) sh.getRange(a.linha, 1, 1, COLS_AP.length).setValues([linhaAp_(a)]);
  else { var l = sh.getLastRow() + 1; sh.getRange(l, 1, 1, COLS_AP.length).setNumberFormat('@').setValues([linhaAp_(a)]); a.linha = l; }
}
function paraCliente_(a) {
  var o = {};
  ['id', 'numero_nf', 'serie_nf', 'cnpj_emissor', 'cod_ocorrencia', 'descricao_ocorrencia', 'data_ocorrencia', 'hora_ocorrencia',
    'recebedor', 'observacao', 'romaneio', 'filial_cte', 'serie_cte', 'numero_cte', 'cod_obs', 'status', 'lote_id'].forEach(function (k) { o[k] = a[k]; });
  return o;
}
function abertosDe_(uid) {
  return apontamentos_().filter(function (a) { return a.usuario_id === uid && a.status === 'ABERTO'; })
    .sort(function (x, y) { return y.id - x.id; });
}

function validar_(d) {
  var c = lerConfig_(), erros = [], oc = {};
  ocorrencias_().forEach(function (o) { oc[o.codigo] = o.descricao; });
  var nf = digitos_(d.numero_nf);
  if (!nf || nf.length > 9 || Number(nf) === 0) erros.push('Informe o número da NF (até 9 dígitos).');
  var cod = ('000' + digitos_(d.cod_ocorrencia)).slice(-3);
  if (!oc[cod]) erros.push('Selecione a ocorrência na lista.');
  var hoje = fmt_(agora_(), 'yyyy-MM-dd');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data_ocorrencia || '')) erros.push('Selecione a data da ocorrência.');
  else if (d.data_ocorrencia > hoje) erros.push('A data da ocorrência não pode ser futura.');
  if (!/^\d{2}:\d{2}/.test(d.hora_ocorrencia || '')) erros.push('Selecione o horário da ocorrência.');
  var em = emitentes_(c), cnpj = digitos_(d.cnpj_emissor) || (em[0] ? em[0].cnpj : '');
  if (cnpj.length !== 14) erros.push('CNPJ do emissor da NF inválido (verifique as configurações).');
  if (erros.length) return { erros: erros };
  return { v: {
    cnpj_emissor: cnpj,
    serie_nf: String(d.serie_nf || c.serie_nf_padrao || '').trim().slice(0, 3),
    numero_nf: ('000000000' + nf).slice(-9),
    cod_ocorrencia: cod,
    descricao_ocorrencia: oc[cod],
    data_ocorrencia: d.data_ocorrencia,
    hora_ocorrencia: d.hora_ocorrencia.slice(0, 5),
    cod_obs: COD_ENTREGUE.indexOf(cod) >= 0 ? '03' : '00',
    recebedor: String(d.recebedor || '').trim().slice(0, 60),
    observacao: String(d.observacao || '').trim().slice(0, 120),
    romaneio: String(d.romaneio || '').trim().slice(0, 20),
    filial_cte: String(d.filial_cte || c.filial_cte || '').trim().slice(0, 10),
    serie_cte: digitos_(d.serie_cte || c.serie_cte || '0').slice(0, 5) || '0',
    numero_cte: digitos_(d.numero_cte).slice(0, 12)
  } };
}

/** Dados iniciais da tela do motorista. */
function iniciar(token) {
  return resp_(function () {
    var u = sessao_(token), c = lerConfig_();
    var oc = ocorrencias_(), mapa = {};
    oc.forEach(function (o) { mapa[o.codigo] = 1; });
    var lotes = lotes_().filter(function (l) { return l.usuario_id === u.id; }).slice(0, 15);
    return {
      usuario: publico_(u), ocorrencias: oc,
      favoritas: (c.favoritas || '').split(',').map(function (x) { return ('000' + digitos_(x)).slice(-3); }).filter(function (x) { return mapa[x]; }),
      emitentes: emitentes_(c), serie_padrao: c.serie_nf_padrao || '', filial_cte: c.filial_cte || '', serie_cte: c.serie_cte || '0',
      registros: abertosDe_(u.id).map(paraCliente_), lotes: lotes, hoje: fmt_(agora_(), 'yyyy-MM-dd')
    };
  });
}

function abertos(token) {
  return resp_(function () { var u = sessao_(token); return { registros: abertosDe_(u.id).map(paraCliente_) }; });
}

function criar(token, dados) {
  return resp_(function () {
    var u = sessao_(token);
    dados = dados || {};
    var r = validar_(dados);
    if (r.erros) return { erro: r.erros.join(' ') };
    return comTrava_(function () {
      var todos = apontamentos_(), uidCli = String(dados.client_uid || '').slice(0, 64);
      if (uidCli) {
        var ja = todos.filter(function (a) { return a.client_uid === uidCli; })[0];
        if (ja) return { registro: paraCliente_(ja), repetido: true };
      }
      var v = r.v, aviso = null;
      var dup = todos.filter(function (a) {
        return a.usuario_id === u.id && a.status === 'ABERTO' && a.numero_nf === v.numero_nf && a.cod_ocorrencia === v.cod_ocorrencia && a.cnpj_emissor === v.cnpj_emissor;
      })[0];
      if (dup) aviso = 'Atenção: esta NF já tem a mesma ocorrência neste apontamento.';
      var maxId = todos.reduce(function (m, a) { return Math.max(m, a.id); }, 0);
      var ts = agoraTxt_();
      var a = v;
      a.id = maxId + 1; a.criado_em = ts; a.atualizado_em = ts; a.motorista = u.nome; a.usuario_login = u.login;
      a.usuario_id = u.id; a.status = 'ABERTO'; a.lote_id = ''; a.client_uid = uidCli;
      gravarAp_(a);
      return { registro: paraCliente_(a), aviso: aviso };
    });
  });
}

function meuAberto_(u, id) {
  var a = apontamentos_().filter(function (x) { return x.id === Number(id) && x.usuario_id === u.id; })[0];
  if (!a) throw new Error('Registro não encontrado.');
  if (a.status !== 'ABERTO') throw new Error('Este apontamento já foi encerrado e não pode ser alterado.');
  return a;
}

function editar(token, id, dados) {
  return resp_(function () {
    var u = sessao_(token);
    var r = validar_(dados || {});
    if (r.erros) return { erro: r.erros.join(' ') };
    return comTrava_(function () {
      var a = meuAberto_(u, id);
      Object.keys(r.v).forEach(function (k) { a[k] = r.v[k]; });
      a.atualizado_em = agoraTxt_();
      gravarAp_(a);
      return { registro: paraCliente_(a) };
    });
  });
}

function excluir(token, id) {
  return resp_(function () {
    var u = sessao_(token);
    return comTrava_(function () {
      var a = meuAberto_(u, id);
      a.status = 'EXCLUIDO'; a.atualizado_em = agoraTxt_();
      gravarAp_(a);
      return { ok: true };
    });
  });
}

/* =====================================================================================
 * ENCERRAMENTO E ARQUIVO OCOREN
 * ===================================================================================== */
function lotes_() {
  var sh = planilha_().getSheetByName(ABA_LOTES);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, COLS_LOTES.length).getValues().map(function (r) {
    return { id: Number(txt_(r[0])), encerrado_em: txt_(r[1]), usuario_id: txt_(r[2]), nome: txt_(r[3]),
      qtd: Number(txt_(r[4])), arquivo_txt: txt_(r[5]), url: txt_(r[6]) };
  }).filter(function (l) { return l.id; }).sort(function (x, y) { return y.id - x.id; });
}

function encerrar(token) {
  return resp_(function () {
    var u = sessao_(token);
    return comTrava_(function () {
      var regs = abertosDe_(u.id).sort(function (x, y) {
        return (x.data_ocorrencia + x.hora_ocorrencia + ('0000000' + x.id).slice(-8)) < (y.data_ocorrencia + y.hora_ocorrencia + ('0000000' + y.id).slice(-8)) ? -1 : 1;
      });
      if (!regs.length) return { erro: 'Não há notas para encerrar.' };
      var c = lerConfig_(), agora = agora_(), lotes = lotes_();
      var hojeBr = fmt_(agora, 'dd/MM/yyyy');
      var seqDia = lotes.filter(function (l) { return l.encerrado_em.slice(0, 10) === hojeBr; }).length + 1;
      var loteId = (lotes.length ? lotes[0].id : 0) + 1;
      var nome = nomeArquivoOcoren_(agora, loteId);
      var conteudo = gerarOcoren_(regs, c, agora, seqDia % 1000 || 1);
      var pasta = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PASTA_ID'));
      var arq = pasta.createFile(nome, conteudo, MimeType.PLAIN_TEXT);
      var ts = fmt_(agora, 'dd/MM/yyyy HH:mm');
      var shL = planilha_().getSheetByName(ABA_LOTES);
      var lin = shL.getLastRow() + 1;
      shL.getRange(lin, 1, 1, COLS_LOTES.length).setNumberFormat('@')
        .setValues([[String(loteId), ts, u.id, u.nome, String(regs.length), nome, arq.getUrl()]]);
      regs.forEach(function (a) {
        a.status = 'ENCERRADO'; a.lote_id = loteId; a.arquivo_txt = nome; a.encerrado_em = ts; a.atualizado_em = ts;
        gravarAp_(a);
      });
      return { ok: true, lote: loteId, arquivo: nome, qtd: regs.length };
    });
  });
}

/** Devolve o conteúdo do TXT para download na própria página. */
function baixarTxt(token, loteId) {
  return resp_(function () {
    var u = sessao_(token);
    var l = lotes_().filter(function (x) { return x.id === Number(loteId); })[0];
    if (!l || (u.perfil !== 'admin' && l.usuario_id !== u.id)) return { erro: 'Arquivo não encontrado.' };
    var pasta = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PASTA_ID'));
    var it = pasta.getFilesByName(l.arquivo_txt);
    if (!it.hasNext()) return { erro: 'Arquivo não encontrado no Google Drive.' };
    return { nome: l.arquivo_txt, conteudo: it.next().getBlob().getDataAsString('US-ASCII') };
  });
}

/* ---------------------------------------------------------------- layout PROCEDA 5.0
 * Linhas de 250 posições, ASCII, CRLF. Registro 542 (1-based):
 *  001-003 "542" | 004-017 CNPJ emissor NF | 018-020 série NF | 021-029 nº NF | 030-032 ocorrência
 *  033-040 data DDMMAAAA | 041-044 hora HHMM | 045-046 cód. observação | 047-066 romaneio
 *  067-126 SAP 1/2/3 | 127-136 filial CT-e | 137-141 série CT-e | 142-153 nº CT-e | 154 tipo entrega
 *  155-250 complementares (preenchidos como no arquivo de exemplo)
 */
function ascii_(t) {
  t = t == null ? '' : String(t);
  t = t.normalize ? t.normalize('NFD').replace(/[̀-ͯ]/g, '') : t;
  return t.replace(/[\r\n\t]/g, ' ').replace(/[^\x20-\x7E]/g, '');
}
function campoA_(v, n) { var s = ascii_(v).slice(0, n); while (s.length < n) s += ' '; return s; }
function campoN_(v, n) { var d = digitos_(v).slice(-n); while (d.length < n) d = '0' + d; return d; }
function rep_(c, n) { return new Array(n + 1).join(c); }
function linha_(s) { return campoA_(s, 250); }

function gerarOcoren_(regs, c, quando, seq) {
  var ddmm = fmt_(quando, 'ddMM');
  var L = [];
  L.push(linha_('000' + campoA_(c.remetente_nome, 35) + campoA_(c.destinatario_nome, 35) +
    fmt_(quando, 'ddMMyy') + fmt_(quando, 'HHmm') + campoA_('OCO50' + ddmm + campoN_(seq, 3), 12)));
  L.push(linha_('540' + campoA_('OCORR50' + ddmm + campoN_(seq, 3), 14)));
  L.push(linha_('541' + campoN_(c.transportadora_cnpj, 14) + campoA_(c.transportadora_nome, 50)));
  regs.forEach(function (r) {
    var d = r.data_ocorrencia;   // AAAA-MM-DD
    var rom = ascii_(r.romaneio || '').slice(0, 20); while (rom.length < 20) rom = ' ' + rom;   // exemplo: alinhado à direita
    L.push(linha_('542' + campoN_(r.cnpj_emissor, 14) + campoA_(r.serie_nf || '', 3) + campoN_(r.numero_nf, 9) +
      campoN_(r.cod_ocorrencia, 3) + d.slice(8, 10) + d.slice(5, 7) + d.slice(0, 4) +
      (digitos_(r.hora_ocorrencia) + '0000').slice(0, 4) + campoN_(r.cod_obs || '0', 2) + rom + rep_(' ', 60) +
      campoA_(r.filial_cte || '', 10) + campoN_(r.serie_cte || '0', 5) + campoN_(r.numero_cte || '0', 12) +
      campoN_(r.tipo_entrega || '1', 1) + rep_(' ', 10) + rep_('0', 62) + rep_(' ', 3) + rep_('0', 9)));
    var t = ascii_(r.descricao_ocorrencia).toUpperCase();
    if (r.recebedor) t += '  - Entrega para: ' + ascii_(r.recebedor).toUpperCase();
    if (r.observacao) t += '  ' + ascii_(r.observacao);
    t += '  via aplicativo movel';
    L.push(linha_('543' + campoA_(t, 210)));
  });
  L.push(linha_('549' + campoN_(regs.length, 4)));
  return L.join('\r\n') + '\r\n';
}
function nomeArquivoOcoren_(quando, numero) {
  return 'ocoren_' + fmt_(quando, 'yyMMddHHmm') + '_' + campoN_(numero, 10) + '.txt';
}

/* =====================================================================================
 * ADMINISTRAÇÃO
 * ===================================================================================== */
function admin(token) {
  return resp_(function () {
    sessao_(token, true);
    var aps = apontamentos_(), hoje = fmt_(agora_(), 'dd/MM/yyyy');
    var abertos = aps.filter(function (a) { return a.status === 'ABERTO'; });
    var hojeEnc = aps.filter(function (a) { return a.status === 'ENCERRADO' && a.encerrado_em.slice(0, 10) === hoje; });
    var us = usuarios_();
    var props = PropertiesService.getScriptProperties();
    return {
      lotes: lotes_().slice(0, 300),
      abertos: abertos.map(function (a) { var o = paraCliente_(a); o.nome = a.motorista; return o; }),
      usuarios: us.map(function (u) {
        var o = publico_(u); o.ativo = u.ativo;
        o.abertos = abertos.filter(function (a) { return a.usuario_id === u.id; }).length; return o;
      }),
      stats: { abertos: abertos.length, hoje: hojeEnc.length,
        entregas: hojeEnc.filter(function (a) { return COD_ENTREGUE.indexOf(a.cod_ocorrencia) >= 0; }).length,
        motoristas: us.filter(function (u) { return u.ativo && u.perfil === 'motorista'; }).length },
      config: lerConfig_(),
      planilhaUrl: planilha_().getUrl(),
      pastaUrl: 'https://drive.google.com/drive/folders/' + props.getProperty('PASTA_ID')
    };
  });
}

function adminCriarUsuario(token, d) {
  return resp_(function () {
    sessao_(token, true);
    d = d || {};
    var login = String(d.login || '').trim().toLowerCase(), nome = String(d.nome || '').trim(), senha = String(d.senha || '');
    if (!/^[a-z0-9._-]{2,30}$/.test(login)) return { erro: 'Usuário deve ter de 2 a 30 caracteres, sem espaços nem acentos.' };
    if (!nome || senha.length < 4) return { erro: 'Preencha o nome e uma senha inicial com pelo menos 4 caracteres.' };
    return comTrava_(function () {
      var us = usuarios_();
      if (us.some(function (u) { return u.login === login; })) return { erro: "Já existe um usuário com o login '" + login + "'." };
      var id = us.reduce(function (m, u) { return Math.max(m, Number(u.id) || 0); }, 0) + 1, sal = Utilities.getUuid();
      var sh = planilha_().getSheetByName(ABA_US), l = sh.getLastRow() + 1;
      sh.getRange(l, 1, 1, COLS_US.length).setNumberFormat('@').setValues([[String(id), login, nome,
        d.perfil === 'admin' ? 'admin' : 'motorista', 'SIM', 'SIM', sal, hash_(senha, sal), agoraTxt_()]]);
      return { ok: true, msg: 'Usuário ' + login + ' criado. No primeiro acesso ele deverá trocar a senha.' };
    });
  });
}

function adminAcaoUsuario(token, uid, acao, senha) {
  return resp_(function () {
    var eu = sessao_(token, true);
    return comTrava_(function () {
      var u = usuarios_().filter(function (x) { return x.id === String(uid); })[0];
      if (!u) return { erro: 'Usuário não encontrado.' };
      var sh = planilha_().getSheetByName(ABA_US);
      if (acao === 'senha') {
        if (String(senha || '').length < 4) return { erro: 'Senha muito curta (mínimo 4).' };
        var sal = Utilities.getUuid();
        sh.getRange(u.linha, 6, 1, 3).setValues([['SIM', sal, hash_(String(senha), sal)]]);
        return { ok: true, msg: 'Senha de ' + u.login + ' redefinida. Ele deverá trocá-la no próximo acesso.' };
      }
      if (acao === 'ativo') {
        if (u.id === eu.id) return { erro: 'Você não pode desativar o próprio usuário.' };
        sh.getRange(u.linha, 5).setValue(u.ativo ? 'NAO' : 'SIM');
        return { ok: true, msg: 'Usuário ' + u.login + (u.ativo ? ' desativado.' : ' reativado.') };
      }
      return { erro: 'Ação inválida.' };
    });
  });
}

function adminSalvarConfig(token, f) {
  return resp_(function () {
    sessao_(token, true);
    f = f || {};
    var erros = [], cnpj = digitos_(f.transportadora_cnpj);
    if (cnpj.length !== 14) erros.push('CNPJ da transportadora deve ter 14 dígitos.');
    var linhas = [];
    String(f.emitentes || '').split(/\r?\n/).forEach(function (ln) {
      if (!ln.trim()) return;
      var p = ln.split(';'), c = digitos_(p[0]);
      if (c.length !== 14) erros.push('CNPJ emissor inválido: ' + ln.trim());
      linhas.push(c + ';' + p.slice(1).join(';').trim());
    });
    if (!linhas.length) erros.push('Informe ao menos um CNPJ emissor de NF.');
    if (erros.length) return { erro: erros.join(' ') };
    comTrava_(function () {
      salvarConfig_({
        remetente_nome: String(f.remetente_nome || '').trim().slice(0, 35),
        destinatario_nome: String(f.destinatario_nome || '').trim().slice(0, 35),
        transportadora_cnpj: cnpj,
        transportadora_nome: String(f.transportadora_nome || '').trim().slice(0, 50),
        emitentes: linhas.join('\n'),
        serie_nf_padrao: String(f.serie_nf_padrao || '').trim().slice(0, 3),
        filial_cte: String(f.filial_cte || '').trim().slice(0, 10),
        serie_cte: digitos_(f.serie_cte).slice(0, 5) || '0',
        favoritas: String(f.favoritas || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean)
          .map(function (x) { return ('000' + digitos_(x)).slice(-3); }).join(','),
        config_revisada: '1'
      });
    });
    return { ok: true, msg: 'Configurações salvas.' };
  });
}

/* =====================================================================================
 * TABELA DE OCORRÊNCIAS EDI PROCEDA (carregada na aba "Ocorrencias" pela configuração)
 * ===================================================================================== */
var OCORRENCIAS_PADRAO = [
  ["000", "Processo de Transporte já Iniciado"],
  ["001", "Entrega Realizada Normalmente"],
  ["002", "Entrega Fora da Data Programada"],
  ["003", "Recusa por Falta de Pedido de Compra"],
  ["004", "Recusa por Pedido de Compra Cancelado"],
  ["005", "Falta de Espaço Físico no Depósito do Cliente Destino"],
  ["006", "Endereço do Cliente Destino não Localizado"],
  ["007", "Devolução não Autorizada pelo Cliente"],
  ["008", "Preço Mercadoria em Desacordo com o Pedido Compra"],
  ["009", "Mercadoria em Desacordo com o Pedido Compra"],
  ["010", "Cliente Destino somente Recebe Mercadoria com Frete Pago"],
  ["011", "Recusa por Deficiência Embalagem Mercadoria"],
  ["012", "Redespacho não Indicado"],
  ["013", "Transportadora não Atende a Cidade do Cliente Destino"],
  ["014", "Mercadoria Sinistrada"],
  ["015", "Embalagem Sinistrada"],
  ["016", "Pedido de Compras em Duplicidade"],
  ["017", "Mercadoria fora da Embalagem de Atacadista"],
  ["018", "Mercadorias Trocadas"],
  ["019", "Reentrega Solicitada pelo Cliente"],
  ["020", "Entrega Prejudicada por Horário/Falta de Tempo Hábil"],
  ["021", "Estabelecimento Fechado"],
  ["022", "Reentrega sem Cobrança do Cliente"],
  ["023", "Extravio de Mercadoria em Trânsito"],
  ["024", "Mercadoria Reentregue ao Cliente Destino"],
  ["025", "Mercadoria Devolvida ao Cliente de Origem"],
  ["026", "Nota Fiscal Retida pela Fiscalização"],
  ["027", "Roubo de Carga"],
  ["028", "Mercadoria Retida até Segunda Ordem"],
  ["029", "Cliente Retira Mercadoria na Transportadora"],
  ["030", "Problema com a Documentação (Nota Fiscal e/ou CTRC)"],
  ["031", "Entrega com Indenização Efetuada"],
  ["032", "Falta com Solicitação de Reposição"],
  ["033", "Falta com Busca/Reconferência"],
  ["034", "Cliente Fechado para Balanço"],
  ["035", "Quantidade de Produto em Desacordo (Nota Fiscal e/ou Pedido)"],
  ["036", "Extravio de documentos pela Cia. Aérea - Cód. Aéreo"],
  ["037", "Extravio de carga pela Cia. Aérea - Cód. Aéreo"],
  ["038", "Avaria de carga pela cia. Aérea"],
  ["039", "Corte de carga na pista - Cód. Aéreo"],
  ["040", "Aeroporto fechado na origem - Cód. Aéreo"],
  ["041", "Pedido de Compra Incompleto"],
  ["042", "Nota Fiscal com Produtos de Setores Diferentes"],
  ["043", "Feriado Local/Nacional"],
  ["044", "Excesso de Veículos"],
  ["045", "Cliente Destino Encerrou Atividades"],
  ["046", "Responsável de Recebimento Ausente"],
  ["047", "Cliente Destino em Greve"],
  ["048", "Aeroporto fechado no destino - Cód. Aéreo"],
  ["049", "Vôo cancelado - Cód. Transp. Aéreo"],
  ["050", "Greve nacional (Greve Geral)"],
  ["051", "Mercadoria Vencida (Data de Validade Expirada)"],
  ["052", "Mercadoria Redespachada (Entregue para Redespacho)"],
  ["053", "Mercadoria não foi Embarcada, Permanecendo na Origem"],
  ["054", "Mercadoria Embarcada sem CTRC ou CTRC não Embarcado"],
  ["055", "Endereço Transp. de Redespacho não localizado/não informado"],
  ["056", "Cliente não Aceita Mercadoria com Pagamento de Reembolso"],
  ["057", "Transp. não atende a cidade da transportadora de redespacho"],
  ["058", "Quebra do Veiculo de Entrega"],
  ["059", "Cliente sem Verba para Pagar o Frete"],
  ["060", "Endereço de Entrega Errado"],
  ["061", "Cliente sem Verba para Reembolso"],
  ["062", "Recusa da Carga por Valor de Frete Errado"],
  ["063", "Identificação do Cliente não Informada/Enviada/Insuficiente"],
  ["064", "Cliente não Identificado/Cadastrado"],
  ["065", "Entrar em Contato com o Comprador"],
  ["066", "Troca não Disponível"],
  ["067", "Fins Estatísticos"],
  ["068", "Data de Entrega Diferente do Pedido"],
  ["069", "Substituição Tributária"],
  ["070", "Sistema Fora do Ar"],
  ["071", "Cliente Destino não Recebe Pedido Parcial"],
  ["072", "Cliente Destino só Recebe Pedido Parcial"],
  ["073", "Redespacho somente com Frete Pago"],
  ["074", "Funcionário não autorizado a Receber Mercadorias"],
  ["075", "Mercadoria Embarcada para Rota Indevida"],
  ["076", "Estrada/Entrada de Acesso Interditada"],
  ["077", "Cliente Destino Mudou de Endereço"],
  ["078", "Avaria Total"],
  ["079", "Avaria Parcial"],
  ["080", "Extravio Total"],
  ["081", "Extravio Parcial"],
  ["082", "Sobra de Mercadoria sem Nota Fiscal"],
  ["083", "Mercadoria em poder da SUFRAMA para Internação"],
  ["084", "Mercadoria Retirada para Conferência"],
  ["085", "Apreensão Fiscal da Mercadoria"],
  ["086", "Excesso de Carga/Peso"],
  ["087", "Férias Coletivas"],
  ["088", "Recusado, aguardando negociação"],
  ["089", "Aguardando refaturamento das mercadorias"],
  ["090", "Recusado pelo Redespachante"],
  ["091", "Entrega Programada"],
  ["092", "Problemas Fiscais"],
  ["093", "Aguardando carta de correção"],
  ["094", "Recusa por divergência nas condições de pagamento"],
  ["095", "Carga aguardando vôo conexão - Cód. Transp. Aéreo"],
  ["096", "Carga sem embalagem própria para transp. Aéreo - Cód. Aéreo"],
  ["097", "Carga com dimensão superior ao porão da aeronave - Cód. Aéreo"],
  ["098", "Chegada na cidade ou filial de destino"],
  ["099", "Outros tipos de ocorrências não especificados acima"],
  ["100", "Devolução por não cumprimento do agendamento"],
  ["101", "Devolução/não entrega a pedido do embarcador"],
  ["102", "Devolução/não entrega a pedido do destinatário"],
  ["103", "Devolução/não entrega a pedido transportadora de redespacho"],
  ["104", "Entrega efetuada na Transportadora de Redespacho"],
  ["105", "Entrega efetuada no cliente pela Transportadora de Redespacho"],
  ["201", "Data da retirada em Manaus"],
  ["202", "Placa da carreta responsável pelo transporte"],
  ["203", "Nome da balsa"],
  ["204", "Nome do empurrador"],
  ["205", "Número da frota"],
  ["206", "Data de chegada em Belém"],
  ["207", "Data de saída de Belém"],
  ["208", "Data de chegada na Transportadora"],
  ["209", "Data de saída da Transportadora"],
  ["210", "Data de chegada no Porto"],
  ["211", "Data de saída do Porto"],
  ["212", "Data de chegada na segunda Transportadora"],
  ["213", "Data de saída da segunda Transportadora (redespacho)"]
];
