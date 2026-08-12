import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ====================== configuração ====================== */
/* Preencha com os dados do seu projeto (Settings → API).
   A anon key pode ficar aqui: ela é pública por design, e o RLS
   é que segura a barra. A service_role NUNCA vem para cá.        */
const SUPABASE_URL = "https://fylctjnwbmfslcfzuoru.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5bGN0am53Ym1mc2xjZnp1b3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0ODQ5NDIsImV4cCI6MjEwMjA2MDk0Mn0.qjuycnZi2ioXioOfwfaXCaGkvnsoWew3c4zxNdZvneQ";

const VERSAO = "1.4.1";   // enter tambem duvida

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.getElementById("app");

/* ====================== estado ====================== */
let eu = JSON.parse(localStorage.getItem("etop:eu") || "null"); // {jogador_id, segredo, sala_id, codigo, nome}
let sala = null;
let jogadores = [];
let canal = null;
let erro = "";
let ocupado = false;
let ignorarConvite = false;

/* Convite: etop.frentedigital.app.br/?s=ABCD */
const codigoLink = (new URLSearchParams(location.search).get("s") || "")
  .toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);

const linkDaSala = (codigo) => `${location.origin}${location.pathname}?s=${codigo}`;

/* Depois de entrar, tira o ?s= da barra: recarregar não deve
   reprocessar um convite que já foi aceito. */
const limparUrl = () => history.replaceState({}, "", location.pathname);

const salvarEu = (v) => { eu = v; localStorage.setItem("etop:eu", JSON.stringify(v)); };
const esquecerEu = () => { eu = null; localStorage.removeItem("etop:eu"); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nomeDe = (id) => jogadores.find((j) => j.id === id)?.nome ?? "alguém";
const norm = (s) => (s || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/* ====================== dados ====================== */
async function puxarTudo() {
  if (!eu?.sala_id) return;
  const [s, j] = await Promise.all([
    sb.from("salas").select("*").eq("id", eu.sala_id).single(),
    sb.from("jogadores").select("*").eq("sala_id", eu.sala_id).order("ordem"),
  ]);
  if (s.error) { esquecerEu(); render(); return; }
  sala = s.data;
  jogadores = j.data ?? [];
  render();
}

function ouvir() {
  if (canal) sb.removeChannel(canal);
  canal = sb.channel(`etop:${eu.sala_id}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "salas", filter: `id=eq.${eu.sala_id}` },
      (p) => { sala = p.new; render(); })
    .on("postgres_changes",
      { event: "*", schema: "public", table: "jogadores", filter: `sala_id=eq.${eu.sala_id}` },
      () => puxarTudo())
    .subscribe();
}

/* ====================== ações ====================== */
async function chamar(fn, args) {
  ocupado = true; erro = ""; render();
  const { data, error } = await sb.rpc(fn, args);
  ocupado = false;
  if (error) { erro = error.message.replace(/^.*?:\s*/, ""); render(); return null; }
  return data;
}

async function criarSala(nome) {
  const d = await chamar("criar_sala", { p_nome: nome });
  if (!d) return;
  salvarEu({ ...d, nome });
  limparUrl();
  await puxarTudo(); ouvir();
}

async function entrarSala(codigo, nome) {
  const d = await chamar("entrar_sala", { p_codigo: codigo, p_nome: nome });
  if (!d) return;
  salvarEu({ ...d, nome });
  limparUrl();
  await puxarTudo(); ouvir();
}

const novaRodada = () => chamar("nova_rodada", { p_jogador: eu.jogador_id, p_segredo: eu.segredo });
const configurar = (t, r) => chamar("configurar_sala", { p_jogador: eu.jogador_id, p_segredo: eu.segredo, p_tempo: t, p_rodadas: r });
const pularTema = () => chamar("pular_tema", { p_jogador: eu.jogador_id, p_segredo: eu.segredo });

/* O relógio é do servidor: passar_vez só passa se o prazo já venceu
   de verdade. Se o celular estiver adiantado, a chamada é ignorada e
   o ticker tenta de novo no segundo seguinte. */
let passando = false;
async function passarVez() {
  if (passando) return;
  passando = true;
  await sb.rpc("passar_vez", { p_jogador: eu.jogador_id, p_segredo: eu.segredo });
  setTimeout(() => { passando = false; }, 1200);
}

async function palpitar(texto) {
  if (sala.ditos.some((d) => norm(d.texto) === norm(texto))) {
    erro = "essa já foi dita"; render(); return;
  }
  await chamar("palpitar", { p_jogador: eu.jogador_id, p_segredo: eu.segredo, p_texto: texto });
}

async function duvidar() {
  ocupado = true; erro = ""; render();
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/duvidar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        // Vai também como Bearer: assim a função responde com o
        // "Verify JWT" ligado ou desligado no painel.
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ jogador_id: eu.jogador_id, segredo: eu.segredo }),
    });
    const d = await r.json();
    if (d.erro) erro = d.erro;
  } catch {
    erro = "não deu para conferir agora — tente de novo";
  }
  ocupado = false; render();
}

function sair() {
  if (canal) sb.removeChannel(canal);
  canal = null; sala = null; jogadores = []; erro = "";
  esquecerEu(); render();
}

/* ====================== telas ====================== */
const topo = (comSair) => `
  <div class="topo">
    <div>
      <div class="chart logo">É top<span>?</span></div>
      <div class="tagline">diga uma da lista — ou finja que sabe</div>
    </div>
    ${comSair ? '<button class="b2 mini" data-a="sair">sair</button>' : ""}
  </div>`;

function telaEntrada() {
  const convite = codigoLink && !ignorarConvite;
  if (convite) {
    app.innerHTML = topo(false) + `
      <div class="card pop" style="text-align:center;border-color:var(--amber)">
        <div class="eyebrow" style="color:var(--amber)">você foi chamado para a sala</div>
        <div class="chart" style="font-size:54px;color:var(--amber);letter-spacing:.12em">${esc(codigoLink)}</div>
      </div>
      <div class="card">
        <div class="eyebrow">seu nome</div>
        <input id="nome" placeholder="Como você aparece na mesa" maxlength="16" value="${esc(eu?.nome ?? "")}">
      </div>
      <button class="b1" data-a="convite-entrar" ${ocupado ? "disabled" : ""}>Entrar na sala ${esc(codigoLink)}</button>
      <button class="b2" data-a="recusar" style="margin-top:10px">Criar outra sala</button>
      ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}`;
    const i = document.getElementById("nome");
    if (i) { i.focus(); i.onkeydown = (e) => { if (e.key === "Enter") entrarSala(codigoLink, i.value.trim()); }; }
    return;
  }

  app.innerHTML = topo(false) + `
    <div class="card">
      <div class="eyebrow">quem está jogando</div>
      <input id="nome" placeholder="Seu nome" maxlength="16" value="${esc(eu?.nome ?? "")}">
    </div>
    <button class="b1" data-a="criar" ${ocupado ? "disabled" : ""}>Criar sala</button>
    <div style="display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--dim);font-size:11px">
      <div style="flex:1;height:1px;background:var(--edge)"></div>ou entre numa
      <div style="flex:1;height:1px;background:var(--edge)"></div>
    </div>
    <div style="display:flex;gap:8px">
      <input id="cod" placeholder="CÓDIGO" maxlength="4"
        style="text-align:center;letter-spacing:.3em;font-weight:700;text-transform:uppercase">
      <button class="b2" data-a="entrar" style="width:100px" ${ocupado ? "disabled" : ""}>Entrar</button>
    </div>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}`;
}

function telaLobby() {
  const souHost = sala.host_id === eu.jogador_id;
  app.innerHTML = topo(true) + `
    <div class="card" style="text-align:center">
      <div class="eyebrow">código da sala</div>
      <div class="chart" style="font-size:54px;color:var(--amber);letter-spacing:.12em">${esc(sala.codigo)}</div>
      <div style="font-size:12px;color:var(--dim);margin-top:8px">Mande o link no grupo — quem abrir já cai aqui dentro.</div>
      <button class="b1" data-a="convidar" style="margin-top:12px;width:auto;padding:10px 22px">convidar</button>
    </div>

    <div class="eyebrow">rodadas na partida</div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      ${[3,5,10].map((v) => {
        const ativo = (sala.n_rodadas ?? 5) === v;
        return `<button class="${ativo ? "b1" : "b2"}" data-a="rodadas" data-v="${v}"
          style="flex:1;padding:10px;font-size:13px" ${souHost ? "" : "disabled"}>${v} rodadas</button>`;
      }).join("")}
    </div>

    <div class="eyebrow">tempo para responder</div>
    <div style="display:flex;gap:8px;margin-bottom:18px">
      ${[[5,"5 segundos"],[10,"10 segundos"],[0,"Sem tempo"]].map(([v,rot]) => {
        const ativo = (sala.tempo_resposta ?? 0) === v;
        return `<button class="${ativo ? "b1" : "b2"}" data-a="tempo" data-v="${v}"
          style="flex:1;padding:10px;font-size:13px" ${souHost ? "" : "disabled"}>${rot}</button>`;
      }).join("")}
    </div>

    <div class="eyebrow">na sala (${jogadores.length})</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px">
      ${jogadores.map((j) => `<span class="tag pop">${esc(j.nome)}${
        j.id === sala.host_id ? '<span style="color:var(--amber);margin-left:6px;font-size:11px">anfitrião</span>' : ""
      }</span>`).join("")}
    </div>
    ${souHost
      ? `<button class="b1" data-a="rodada" ${jogadores.length < 2 || ocupado ? "disabled" : ""}>${
          jogadores.length < 2 ? "Esperando mais alguém…" : "Começar a partida"}</button>`
      : `<p class="pulse" style="color:var(--dim);font-size:13px">Esperando ${esc(nomeDe(sala.host_id))} começar…</p>`}
    <p style="font-size:11px;color:var(--dim);margin-top:16px;line-height:1.6">
      Cada palpite vale +1. Duvidou certo ou sobreviveu à dúvida: +4 e a rodada acaba.
      Estourou o tempo: fora da rodada. Dez palpites sem dúvida: quem falou mais leva.
      A carta roda entre os jogadores, e cada um tem 1 pulo de tema por partida.</p>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}`;
}

function telaJogo() {
  const ditos = sala.ditos ?? [];
  const elim = sala.eliminados ?? [];
  const fora = (id) => elim.includes(id);
  const souEliminado = fora(eu.jogador_id);
  const ult = ditos.length ? ditos[ditos.length - 1] : null;
  const emDisputa = !!sala.duvidando;
  const minhaVez = sala.vez_de === eu.jogador_id && !emDisputa && !souEliminado;
  const podeDuvidar = !!ult && !emDisputa && !souEliminado && ult.jogador_id !== eu.jogador_id;
  const anteriores = ditos.slice(0, -1);
  const meusPulos = jogadores.find((j) => j.id === eu.jogador_id)?.pulos ?? 0;
  const podePular = sala.puxador === eu.jogador_id && ditos.length === 0 && !emDisputa && meusPulos > 0;

  app.innerHTML = topo(true) + `
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-bottom:10px">
      <span>rodada ${sala.rodada_n} de ${sala.n_rodadas}</span>
      <span>${jogadores.map((j) => `${esc(j.nome)} ${j.pontos}${fora(j.id) ? " ✕" : ""}`).join("  ·  ")}</span>
    </div>

    <div class="card">
      ${sala.vez_expira && !emDisputa
        ? `<div style="display:flex;justify-content:flex-end;margin-bottom:-6px">
             <span id="cronometro" class="chart" style="font-size:22px;color:var(--dim)">–</span>
           </div>` : ""}
      <div class="chart" style="font-size:24px">${esc(sala.pergunta ?? "")}</div>
      <div class="fita">${Array.from({ length: 10 }, (_, i) =>
        `<div class="slot ${i < ditos.length ? "on" : ""}"></div>`).join("")}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <span style="font-size:10.5px;color:var(--dim)">${ditos.length} de 10 lugares chutados · +1 por palpite</span>
        ${podePular ? `<button class="b2 mini" data-a="pular" ${ocupado ? "disabled" : ""}>pular tema (${meusPulos})</button>` : ""}
      </div>
    </div>

    ${anteriores.length ? `<div class="eyebrow">já foi dito</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${anteriores.map((d) => `<span class="dito">${esc(d.texto)}<span style="color:var(--dim)"> · ${esc(nomeDe(d.jogador_id))}</span></span>`).join("")}
      </div>` : ""}

    ${ult ? `
      <div class="card pop" style="border-color:var(--pink)">
        <div class="eyebrow" style="color:var(--pink)">no ar</div>
        <div class="chart" style="font-size:26px">${esc(ult.texto)}</div>
        <div style="font-size:12px;color:var(--dim);margin-top:4px">disse ${esc(nomeDe(ult.jogador_id))}</div>
        ${emDisputa
          ? `<p class="pulse" style="color:var(--pink);font-size:14px;margin-top:12px;font-weight:700">
               ${esc(nomeDe(sala.duvidando))} duvidou! conferindo…</p>`
          : podeDuvidar
            ? `<button class="bd" data-a="duvidar" style="width:100%;margin-top:14px" ${ocupado ? "disabled" : ""}>${ocupado ? "conferindo…" : "DUVIDO (+4)"}</button>`
            : souEliminado
              ? `<p style="color:var(--dim);font-size:12px;margin-top:12px">Você está fora desta rodada.</p>`
              : `<p style="color:var(--dim);font-size:12px;margin-top:12px">Do seu palpite você não pode duvidar.</p>`}
      </div>` : ""}

    ${minhaVez ? `
      <div class="card" style="border-color:var(--amber)">
        <div class="eyebrow" style="color:var(--amber)">é com você (+1 por palpite)</div>
        <input id="palpite" placeholder="Diga uma da lista" maxlength="40" autocomplete="off">
        <button class="b1" data-a="palpitar" style="margin-top:10px">Falar</button>
      </div>`
    : souEliminado && !ult
      ? `<p style="color:var(--dim);font-size:13px">Você está fora desta rodada — espere a próxima carta.</p>`
      : !emDisputa && sala.vez_de
        ? `<p class="pulse" style="color:var(--dim);font-size:13px">Vez de ${esc(nomeDe(sala.vez_de))} — corra se quiser duvidar.</p>`
        : ""}
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}`;

  const inp = document.getElementById("palpite");
  if (inp) { inp.focus(); inp.onkeydown = (e) => { if (e.key === "Enter") palpitar(inp.value.trim()); }; }
}

function telaReveal() {
  const r = sala.resultado ?? {};
  const fim = sala.fase === "fim";
  const placar = [...jogadores].sort((a, b) => b.pontos - a.pontos);
  const foiDito = (resp) => (r.ditos ?? []).some((d) => norm(d.texto) === norm(resp));
  // o puxador da próxima carta, pelo rodízio (jogadores já vêm por ordem)
  const proxPuxador = jogadores.length ? jogadores[sala.rodada_n % jogadores.length] : null;
  const possoPuxar = !fim && proxPuxador && (proxPuxador.id === eu.jogador_id || sala.host_id === eu.jogador_id);

  let manchete = "";
  if (r.tipo === "duvida") {
    manchete = `
      <div class="card pop" style="border-color:${r.pos ? "var(--mint)" : "var(--pink)"}">
        <div class="eyebrow" style="color:${r.pos ? "var(--mint)" : "var(--pink)"}">
          ${r.pos ? "estava na lista" : "não estava na lista"}</div>
        <div class="chart" style="font-size:26px">${esc(r.palpite)}${
          r.pos ? ` <span style="color:var(--amber)">— ${r.pos}º</span>` : ""}</div>
        <div style="font-size:13px;color:var(--dim);margin-top:8px;line-height:1.5">
          ${esc(nomeDe(r.duvidador))} duvidou de ${esc(nomeDe(r.palpiteiro))}.
          <strong style="color:var(--paper)">${esc(nomeDe(r.ganhador))} leva a rodada: +4.</strong>
          ${r.pos ? "" : "O palpite furado devolveu o +1."}</div>
      </div>`;
  } else if (r.tipo === "lista_cheia") {
    const nomes = (r.vencedores ?? []).map((id) => esc(nomeDe(id))).join(" e ");
    manchete = `
      <div class="card pop" style="border-color:var(--amber)">
        <div class="eyebrow" style="color:var(--amber)">dez palpites e ninguém duvidou</div>
        <div style="font-size:14px;line-height:1.5">Quem mais falou leva a rodada:
          <strong>${nomes}</strong> com ${r.max_palpites} palpite(s). +4 para cada.</div>
      </div>`;
  } else if (r.tipo === "sobrou_um") {
    manchete = `
      <div class="card pop" style="border-color:var(--amber)">
        <div class="eyebrow" style="color:var(--amber)">todo mundo estourou o tempo</div>
        <div style="font-size:14px">Sobrou só ${esc(nomeDe(r.vencedor))} — leva a rodada: +4.</div>
      </div>`;
  }

  app.innerHTML = topo(true) + manchete + `
    <div class="eyebrow">a lista de verdade</div>
    <div class="card" style="padding:10px 12px">
      ${(r.itens ?? []).map((it) => {
        const oPalpite = r.tipo === "duvida" && it.n === r.pos;
        return `<div style="display:flex;gap:10px;padding:5px 0;font-size:14px;color:${
          oPalpite ? "var(--amber)" : foiDito(it.resposta) ? "var(--mint)" : "var(--paper)"}">
          <span class="chart" style="width:24px;text-align:right;color:var(--dim)">${it.n}</span>
          <span>${esc(it.resposta)}</span></div>`;
      }).join("")}
      ${r.criterio ? `<div style="font-size:10.5px;color:var(--dim);margin-top:8px;
        border-top:1px solid var(--edge);padding-top:8px">${esc(r.criterio)}</div>` : ""}
    </div>

    <div class="eyebrow">placar — rodada ${sala.rodada_n} de ${sala.n_rodadas}</div>
    <div class="card" style="padding:10px 12px">
      ${placar.map((j) => `<div class="linha"><span>${esc(j.nome)}</span>
        <span class="chart" style="color:var(--amber);font-size:18px">${j.pontos}</span></div>`).join("")}
    </div>

    ${fim
      ? `<div style="text-align:center">
           <div class="chart" style="font-size:30px;color:var(--amber)">${esc(placar[0].nome)} levou a partida</div>
           <button class="b2" data-a="sair" style="margin-top:14px">Voltar ao início</button></div>`
      : possoPuxar
        ? `<button class="b1" data-a="rodada" ${ocupado ? "disabled" : ""}>${ocupado ? "Virando carta…" : "Puxar a próxima carta"}</button>`
        : `<p class="pulse" style="color:var(--dim);font-size:13px">${esc(proxPuxador ? nomeDe(proxPuxador.id) : "")} puxa a próxima carta…</p>`}
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}`;
}

function render() {
  desenhar();
  // link de convite para uma sala diferente da que você já está
  if (codigoLink && !ignorarConvite && sala && sala.codigo !== codigoLink) {
    const d = document.createElement("div");
    d.className = "card pop";
    d.style.cssText = "border-color:var(--amber);margin-top:14px;text-align:center";
    d.innerHTML = `<div style="font-size:13px;margin-bottom:10px">Te chamaram para a sala
      <strong style="color:var(--amber)">${esc(codigoLink)}</strong>. Sair desta e ir para lá?</div>
      <div style="display:flex;gap:8px">
        <button class="ba" data-a="recusar">Ficar aqui</button>
        <button class="bd" data-a="trocar">Ir para ${esc(codigoLink)}</button>
      </div>`;
    app.appendChild(d);
  }
}

function desenhar() {
  if (!eu?.sala_id) return telaEntrada();
  if (!sala) { app.innerHTML = topo(true) + '<p class="pulse" style="color:var(--dim)">Carregando a sala…</p>'; return; }
  if (sala.fase === "lobby") return telaLobby();
  if (sala.fase === "jogo") return telaJogo();
  return telaReveal();
}

/* ====================== eventos ====================== */
app.addEventListener("click", (e) => {
  const a = e.target.closest("[data-a]")?.dataset.a;
  if (!a) return;
  if (a === "criar")   return criarSala(document.getElementById("nome").value.trim());
  if (a === "entrar")  return entrarSala(document.getElementById("cod").value.trim().toUpperCase(),
                                         document.getElementById("nome").value.trim());
  if (a === "convite-entrar") return entrarSala(codigoLink, document.getElementById("nome").value.trim());
  if (a === "tempo")   return configurar(Number(e.target.closest("[data-a]").dataset.v), sala?.n_rodadas ?? 5);
  if (a === "rodadas") return configurar(sala?.tempo_resposta ?? 0, Number(e.target.closest("[data-a]").dataset.v));
  if (a === "pular")   return pularTema();
  if (a === "rodada")  return novaRodada();
  if (a === "palpitar")return palpitar(document.getElementById("palpite").value.trim());
  if (a === "duvidar") return duvidar();
  if (a === "sair")    return sair();
  if (a === "convidar") return convidar();
  if (a === "trocar")   { ignorarConvite = false; sair(); return; }
  if (a === "recusar")  { ignorarConvite = true; render(); return; }
});

/* ====================== convite ====================== */
async function convidar() {
  const link = linkDaSala(sala.codigo);
  const texto = `Bora jogar É top? Sala ${sala.codigo}: ${link}`;
  const b = document.querySelector('[data-a="convidar"]');
  try {
    // no celular abre a folha de compartilhamento (WhatsApp e cia)
    if (navigator.share) { await navigator.share({ title: "É top?", text: texto, url: link }); return; }
    await navigator.clipboard.writeText(link);
    if (b) { b.textContent = "link copiado"; setTimeout(() => { b.textContent = "convidar"; }, 2000); }
  } catch { /* usuário cancelou */ }
}

/* ====================== enter para duvidar ====================== */
/* Enter DENTRO do campo de palpite envia o palpite (comportamento
   que já existia). Enter com o campo fora de foco dispara o DUVIDO,
   se o botão estiver visível. Espaço também vale, por ser a tecla
   mais rápida de acertar no desespero. */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  if (e.repeat) return;                                   // segurar a tecla não metralha
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "BUTTON")) return;
  const btn = document.querySelector('[data-a="duvidar"]');
  if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
});

/* ====================== cronômetro ====================== */
/* Atualiza só o número, sem redesenhar a tela — se re-renderizasse a
   cada segundo, o texto que a pessoa está digitando se perderia. */
setInterval(() => {
  const el = document.getElementById("cronometro");
  if (!el || !sala?.vez_expira || sala.duvidando || sala.fase !== "jogo") return;
  const resta = Math.max(0, Math.ceil((Date.parse(sala.vez_expira) - Date.now()) / 1000));
  el.textContent = resta + "s";
  el.style.color = resta <= 3 ? "var(--pink)" : "var(--dim)";
  if (resta === 0) passarVez();
}, 500);

/* ====================== selo de versão ====================== */
/* Fica no canto e serve para duas coisas: saber o que cada celular
   está rodando, e forçar atualização quando o service worker teimar
   em servir a versão antiga. */
function selo() {
  const d = document.createElement("div");
  d.id = "selo";
  d.textContent = "v" + VERSAO;
  d.title = "Toque para atualizar o app";
  d.style.cssText = [
    "position:fixed", "right:10px", "bottom:max(8px,env(safe-area-inset-bottom))",
    "font-size:10px", "letter-spacing:.08em", "color:var(--dim)",
    "background:var(--panel)", "border:1px solid var(--edge)",
    "border-radius:20px", "padding:3px 9px", "opacity:.6",
    "cursor:pointer", "z-index:50", "user-select:none",
  ].join(";");
  d.onclick = atualizar;
  document.body.appendChild(d);
}

async function atualizar() {
  const d = document.getElementById("selo");
  if (d) { d.textContent = "atualizando…"; d.style.opacity = "1"; }
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map((k) => caches.delete(k)));
    }
  } catch { /* segue e recarrega assim mesmo */ }
  location.reload();
}

/* ====================== partida ====================== */
selo();
render();
if (eu?.sala_id) { puxarTudo().then(ouvir); }

// realtime cai quando o celular dorme: ressincroniza ao voltar
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && eu?.sala_id) puxarTudo();
});
