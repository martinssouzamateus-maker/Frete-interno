(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("dados").textContent);
  var CSRF = document.querySelector("meta[name=csrf]").content;
  var OC = {};
  D.ocorrencias.forEach(function (o) { OC[o.codigo] = o.descricao; });
  var ENTREGUE = ["001", "002", "024", "031", "104", "105"];
  var K_FILA = "fi_fila_" + D.usuario, K_RASC = "fi_rascunho_" + D.usuario;
  var CAMPOS = ["numero_nf", "serie_nf", "cnpj_emissor", "cod_ocorrencia", "data_ocorrencia", "hora_ocorrencia",
    "recebedor", "observacao", "romaneio", "filial_cte", "serie_cte", "numero_cte"];

  var $ = function (id) { return document.getElementById(id); };
  var registros = [], editandoId = null, enviando = false;

  // ---------------------------------------------------------------- armazenamento local (seguro)
  function ler(k, padrao) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } }
  function gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function fila() { return ler(K_FILA, []); }

  // ---------------------------------------------------------------- utilitarios
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function agoraData() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function agoraHora() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function br(iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : ""; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function nfCurta(n) { return String(n || "").replace(/^0+(?=\d)/, ""); }

  var tTimer;
  function toast(msg, erro) {
    var t = $("toast"); t.textContent = msg; t.className = "toast vis" + (erro ? " erro" : "");
    clearTimeout(tTimer); tTimer = setTimeout(function () { t.className = "toast"; }, 3200);
  }
  function status(tipo, txt) { $("status").className = "status " + (tipo || ""); $("statusTxt").textContent = txt; }

  function api(metodo, url, corpo) {
    return fetch(url, {
      method: metodo, credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF },
      body: corpo ? JSON.stringify(corpo) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { location.href = "/login?proximo=/apontamento"; }
        if (!r.ok) { var e = new Error(j.erro || "Erro " + r.status); e.http = r.status; throw e; }
        return j;
      });
    });
  }

  // ---------------------------------------------------------------- formulario
  function valores() {
    var v = {};
    CAMPOS.forEach(function (c) { var el = $(c); v[c] = el ? el.value.trim() : ""; });
    return v;
  }
  function preencher(v) {
    CAMPOS.forEach(function (c) { var el = $(c); if (el && v[c] != null) el.value = v[c]; });
    escolher(v.cod_ocorrencia || "", true);
  }
  function salvarRascunho() { if (!editandoId) gravar(K_RASC, valores()); }

  function escolher(cod, silencioso) {
    $("cod_ocorrencia").value = cod;
    var tem = !!OC[cod];
    $("ocorrCod").textContent = tem ? cod : "?";
    $("ocorrCod").className = "cod" + (tem ? "" : " cinza");
    $("ocorrTxt").textContent = tem ? OC[cod] : "Toque para escolher na lista";
    $("ocorrTxt").className = tem ? "" : "vazio";
    $("ocorrBtn").classList.remove("invalido");
    document.querySelectorAll("#favoritas .chip").forEach(function (c) { c.setAttribute("aria-pressed", c.dataset.cod === cod ? "true" : "false"); });
    $("campoRecebedor").classList.toggle("oculto", tem && ENTREGUE.indexOf(cod) < 0);
    if (!silencioso) salvarRascunho();
  }

  function validar(v) {
    var erros = [];
    document.querySelectorAll(".invalido").forEach(function (e) { e.classList.remove("invalido"); });
    if (!/^\d{1,9}$/.test(v.numero_nf) || +v.numero_nf === 0) { erros.push("Informe o número da NF."); $("numero_nf").classList.add("invalido"); }
    if (!OC[v.cod_ocorrencia]) { erros.push("Escolha a ocorrência."); $("ocorrBtn").classList.add("invalido"); }
    if (!v.data_ocorrencia) { erros.push("Selecione a data."); $("data_ocorrencia").classList.add("invalido"); }
    else if (v.data_ocorrencia > agoraData()) { erros.push("A data não pode ser futura."); $("data_ocorrencia").classList.add("invalido"); }
    if (!v.hora_ocorrencia) { erros.push("Selecione o horário."); $("hora_ocorrencia").classList.add("invalido"); }
    return erros;
  }
  function mostrarErro(msg) { var e = $("erroForm"); e.textContent = msg || ""; e.classList.toggle("oculto", !msg); }

  function limparAposSalvar() {
    ["numero_nf", "recebedor", "observacao", "numero_cte"].forEach(function (c) { $(c).value = ""; });
    $("hora_ocorrencia").value = agoraHora();
    salvarRascunho();
    $("numero_nf").focus();
  }

  function sairEdicao() {
    editandoId = null;
    $("form").classList.remove("editando");
    $("tituloForm").textContent = "Nova ocorrência";
    $("salvarBtn").textContent = "Adicionar NF";
    $("cancelarBtn").classList.add("oculto");
    mostrarErro("");
    var r = ler(K_RASC, null);
    preencher(r || {});
    ["numero_nf", "recebedor", "observacao", "numero_cte"].forEach(function (c) { if (!r) $(c).value = ""; });
  }

  function editar(id) {
    var r = registros.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    salvarRascunho();
    editandoId = id;
    var v = {}; CAMPOS.forEach(function (c) { v[c] = r[c] == null ? "" : r[c]; });
    v.numero_nf = nfCurta(r.numero_nf);
    preencher(v);
    $("form").classList.add("editando");
    $("tituloForm").textContent = "Editando NF " + nfCurta(r.numero_nf);
    $("salvarBtn").textContent = "Salvar alteração";
    $("cancelarBtn").classList.remove("oculto");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (enviando) return;
    var v = valores();
    var erros = validar(v);
    if (erros.length) { mostrarErro(erros.join(" ")); return; }
    mostrarErro("");
    enviando = true; $("salvarBtn").disabled = true;
    status("salvando", "Salvando…");

    if (editandoId) {
      var idEd = editandoId;
      api("PUT", "/api/apontamentos/" + idEd, v).then(function () {
        toast("Alteração salva"); sairEdicao(); return carregar(idEd);
      }).catch(function (e) { mostrarErro(e.message); status("erro", "Não salvo"); })
        .then(function () { enviando = false; $("salvarBtn").disabled = false; if (!$("erroForm").textContent) render(); });
      return;
    }

    v.client_uid = uid();
    api("POST", "/api/apontamentos", v).then(function (j) {
      toast(j.aviso ? j.aviso : "NF " + nfCurta(j.registro.numero_nf) + " salva", !!j.aviso);
      limparAposSalvar();
      return carregar(j.registro.id);
    }).catch(function (e) {
      if (e.http) { mostrarErro(e.message); status("erro", "Não salvo"); return; }
      // sem conexao: guarda no aparelho e envia depois
      var f = fila(); f.push(v); gravar(K_FILA, f);
      toast("Sem conexão. NF guardada no celular e será enviada automaticamente.");
      limparAposSalvar();
    }).then(function () { enviando = false; $("salvarBtn").disabled = false; if (!$("erroForm").textContent) render(); });
  });

  $("cancelarBtn").addEventListener("click", sairEdicao);
  $("agoraBtn").addEventListener("click", function () {
    $("data_ocorrencia").value = agoraData(); $("hora_ocorrencia").value = agoraHora(); salvarRascunho();
  });
  CAMPOS.forEach(function (c) { var el = $(c); if (el) el.addEventListener("input", salvarRascunho); });
  $("numero_nf").addEventListener("input", function () { this.value = this.value.replace(/\D/g, "").slice(0, 9); });

  // ---------------------------------------------------------------- seletor de ocorrencias
  function abrir(id) { $(id).classList.remove("oculto"); document.body.style.overflow = "hidden"; }
  function fechar(id) { $(id).classList.add("oculto"); document.body.style.overflow = ""; }
  document.querySelectorAll("[data-fechar]").forEach(function (b) {
    b.addEventListener("click", function () { fechar(b.closest(".fundo").id); });
  });
  document.querySelectorAll(".fundo").forEach(function (f) {
    f.addEventListener("click", function (e) { if (e.target === f && !f.dataset.travado) fechar(f.id); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") document.querySelectorAll(".fundo:not(.oculto)").forEach(function (f) { if (!f.dataset.travado) fechar(f.id); });
  });

  function normal(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function opcaoHTML(o, atual) {
    return '<button type="button" class="opcao" role="option" data-cod="' + o.codigo + '" aria-selected="' + (o.codigo === atual) + '">' +
      '<span class="cod peq">' + o.codigo + "</span><span>" + esc(o.descricao) + "</span></button>";
  }
  function listarOcorr() {
    var q = normal($("busca").value.trim()), atual = $("cod_ocorrencia").value, html = "";
    var achados = D.ocorrencias.filter(function (o) { return !q || o.codigo.indexOf(q) === 0 || normal(o.descricao).indexOf(q) >= 0; });
    if (!q && D.favoritas.length) {
      html += '<div class="grupo-tit">Mais usadas</div>';
      D.favoritas.forEach(function (c) { html += opcaoHTML({ codigo: c, descricao: OC[c] }, atual); });
      html += '<div class="grupo-tit">Todas as ocorrências</div>';
    }
    achados.forEach(function (o) { html += opcaoHTML(o, atual); });
    if (!achados.length) html = '<p class="vazio-lista" style="margin-top:12px">Nenhuma ocorrência encontrada para “' + esc($("busca").value) + '”.</p>';
    $("listaOcorr").innerHTML = html;
  }
  $("ocorrBtn").addEventListener("click", function () {
    $("busca").value = ""; listarOcorr(); abrir("folhaOcorr");
    $("listaOcorr").scrollTop = 0;
    if (window.matchMedia("(min-width: 700px)").matches) $("busca").focus();
  });
  $("busca").addEventListener("input", listarOcorr);
  $("listaOcorr").addEventListener("click", function (e) {
    var b = e.target.closest(".opcao"); if (!b) return;
    escolher(b.dataset.cod); fechar("folhaOcorr");
  });
  $("favoritas").addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (b) escolher(b.dataset.cod);
  });

  // ---------------------------------------------------------------- lista
  function render(realceId) {
    var f = fila(), html = "";
    f.slice().reverse().forEach(function (v) {
      html += '<li class="item"><span class="cod peq">' + esc(v.cod_ocorrencia) + '</span><div><div class="nf-num">NF ' + esc(nfCurta(v.numero_nf)) +
        '<span class="tag pend">aguardando conexão</span></div><div class="desc">' + esc(OC[v.cod_ocorrencia]) +
        '</div><div class="meta">' + br(v.data_ocorrencia) + " às " + esc(v.hora_ocorrencia) + "</div></div><span></span></li>";
    });
    registros.forEach(function (r) {
      var meta = br(r.data_ocorrencia) + " às " + esc(r.hora_ocorrencia) + (r.serie_nf ? " · série " + esc(r.serie_nf) : "");
      if (r.recebedor) meta += "<br>Recebido por " + esc(r.recebedor);
      if (r.observacao) meta += "<br>" + esc(r.observacao);
      html += '<li class="item' + (r.id === realceId ? " realce" : "") + '"><span class="cod peq">' + r.cod_ocorrencia + '</span><div><div class="nf-num">NF ' +
        esc(nfCurta(r.numero_nf)) + '</div><div class="desc">' + esc(r.descricao_ocorrencia) + '</div><div class="meta">' + meta + "</div></div>" +
        '<div class="acoes"><button class="btn-txt" data-editar="' + r.id + '">Editar</button><button class="btn-txt btn-perigo" data-excluir="' + r.id + '">Excluir</button></div></li>';
    });
    $("lista").innerHTML = html;
    var total = registros.length + f.length;
    $("qtd").textContent = total + (total === 1 ? " nota" : " notas");
    $("vazio").classList.toggle("oculto", total > 0);
    var btn = $("encerrarBtn");
    btn.disabled = !registros.length || f.length > 0;
    btn.textContent = f.length ? "Aguardando envio de " + f.length + " nota" + (f.length > 1 ? "s" : "") :
      (registros.length ? "Encerrar e gerar arquivo (" + registros.length + ")" : "Encerrar e gerar arquivo");
    if (f.length) status("offline", f.length + " no celular, aguardando conexão");
    else if (!enviando) status("", "Tudo salvo");
  }

  $("lista").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.editar) editar(+b.dataset.editar);
    if (b.dataset.excluir) {
      if (b.dataset.confirmar) {
        var id = +b.dataset.excluir;
        api("DELETE", "/api/apontamentos/" + id).then(function () {
          toast("NF excluída"); if (editandoId === id) sairEdicao(); carregar();
        }).catch(function (er) { toast(er.message, true); });
      } else {
        b.dataset.confirmar = "1"; b.textContent = "Confirmar";
        setTimeout(function () { if (b.isConnected) { delete b.dataset.confirmar; b.textContent = "Excluir"; } }, 3500);
      }
    }
  });

  function carregar(realceId) {
    return api("GET", "/api/abertos").then(function (j) {
      registros = j.registros; render(realceId);
    }).catch(function (e) { if (!e.http) status("offline", "Sem conexão"); render(); });
  }

  // envia notas guardadas no aparelho
  var sincronizando = false;
  function enviarFila() {
    var f = fila();
    if (!f.length || sincronizando) return;
    sincronizando = true;
    var v = f[0];
    api("POST", "/api/apontamentos", v).then(function () {
      var g = fila(); g.shift(); gravar(K_FILA, g);
      sincronizando = false;
      if (g.length) enviarFila(); else { toast("Notas pendentes enviadas"); carregar(); }
    }).catch(function (e) {
      sincronizando = false;
      if (e.http === 422) { // dado invalido: devolve ao formulario para corrigir
        var g = fila(); g.shift(); gravar(K_FILA, g); preencher(v); mostrarErro("NF " + v.numero_nf + " não foi aceita: " + e.message); render();
      }
    });
  }
  window.addEventListener("online", enviarFila);
  setInterval(enviarFila, 15000);
  setInterval(function () { if (!document.hidden && !editandoId) carregar(); }, 60000);

  // ---------------------------------------------------------------- encerrar
  $("encerrarBtn").addEventListener("click", function () {
    var nfs = registros.length;
    var porCod = {};
    registros.forEach(function (r) { porCod[r.cod_ocorrencia] = (porCod[r.cod_ocorrencia] || 0) + 1; });
    var resumo = Object.keys(porCod).sort().map(function (c) {
      return '<li class="item" style="grid-template-columns:auto 1fr auto;padding:8px 0"><span class="cod peq">' + c + "</span><div>" + esc(OC[c]) + "</div><b>" + porCod[c] + "</b></li>";
    }).join("");
    $("tEnc").textContent = "Encerrar apontamento?";
    $("encCorpo").innerHTML = "<p style='margin:0 0 6px'>Será gerado o arquivo OCOREN com <b>" + nfs + " nota" + (nfs > 1 ? "s" : "") +
      "</b>. Depois de encerrado, este apontamento não poderá ser alterado.</p><ul class='lista'>" + resumo + "</ul>";
    $("encRodape").classList.remove("oculto");
    $("confirmaEnc").disabled = false;
    abrir("folhaEnc");
  });

  $("confirmaEnc").addEventListener("click", function () {
    var b = this; b.disabled = true; b.textContent = "Gerando arquivo…";
    $("folhaEnc").dataset.travado = "1";
    api("POST", "/api/encerrar").then(function (j) {
      $("tEnc").textContent = "Apontamento encerrado";
      $("encCorpo").innerHTML = '<div class="sucesso"><div class="check" aria-hidden="true">✓</div><p style="margin:0">' + j.qtd +
        " nota" + (j.qtd > 1 ? "s enviadas" : " enviada") + " e registrada" + (j.qtd > 1 ? "s" : "") + ' na planilha.</p><div class="arq">' + esc(j.arquivo) + "</div>" +
        (j.aviso ? '<div class="aviso atencao" style="text-align:left">' + esc(j.aviso) + "</div>" : "") +
        '<a class="btn btn-sec bloco" href="' + j.download + '">Baixar arquivo TXT</a></div>';
      $("encRodape").innerHTML = '<button class="btn btn-pri" onclick="location.reload()">Iniciar novo apontamento</button>';
      registros = []; render();
    }).catch(function (e) {
      toast(e.message, true); fechar("folhaEnc");
    }).then(function () {
      delete $("folhaEnc").dataset.travado; b.disabled = false; b.textContent = "Encerrar e gerar arquivo";
    });
  });

  // ---------------------------------------------------------------- inicio
  var r = ler(K_RASC, null);
  if (r) preencher(r); else escolher("", true);
  if (!$("data_ocorrencia").value) $("data_ocorrencia").value = agoraData();
  if (!$("hora_ocorrencia").value) $("hora_ocorrencia").value = agoraHora();
  render();
  carregar().then(enviarFila);
})();
