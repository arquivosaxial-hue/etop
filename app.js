import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ====================== configuração ====================== */
/* Preencha com os dados do seu projeto (Settings → API).
   A anon key pode ficar aqui: ela é pública por design, e o RLS
   é que segura a barra. A service_role NUNCA vem para cá.        */
const SUPABASE_URL = "https://fylctjnwbmfslcfzuoru.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5bGN0am53Ym1mc2xjZnp1b3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0ODQ5NDIsImV4cCI6MjEwMjA2MDk0Mn0.qjuycnZi2ioXioOfwfaXCaGkvnsoWew3c4zxNdZvneQ";

const VERSAO = "1.1.0";   // corrida livre no duvidar

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.getElementById("app");

/* ====================== estado ====================== */
let eu = JSON.parse(localStorage.getItem("etop:eu") || "null"); // {jogador_id, segredo, sala_id, codigo, nome}
let sala = null;
let jogadores = [];
let canal = null;
let erro = "";
let ocupado = false;

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
  await puxarTudo(); ouvir();
}

async function entrarSala(codigo, nome) {
  const d = await chamar("entrar_sala", { p_codigo: codigo, p_nome: nome });
  if (!d) return;
  salvarEu({ ...d, nome });
  await puxarTudo(); ouvir();
}

const novaRodada = () => chamar("nova_rodada", { p_jogador: eu.jogador_id, p_segredo: eu.segredo });

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
      <div style="font-size:12px;color:var(--dim);margin-top:8px">Mande o link e esse código para o grupo.</div>
      <button class="b2 mini" data-a="copiar" style="margin-top:12px">copiar link</button>
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
    <p style="font-size:11px;color:var(--dim);margin-top:16px;line-height:1.5">
      Primeiro a fazer ${sala.meta} pontos leva. Duvidou certo, +2. Duvidou errado, +2 para quem palpitou.</p>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}`;
}

function telaJogo() {
  const ditos = sala.ditos ?? [];
  const ult = ditos.length ? ditos[ditos.length - 1] : null;
  const emDisputa = !!sala.duvidando;
  const minhaVez = sala.vez_de === eu.jogador_id && !emDisputa;
  // qualquer um menos quem falou, enquanto o próximo palpite não entra
  const podeDuvidar = !!ult && !emDisputa && ult.jogador_id !== eu.jogador_id;
  const anteriores = ditos.slice(0, -1);

  app.innerHTML = topo(true) + `
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-bottom:10px">
      <span>rodada ${sala.rodada_n}</span>
      <span>${jogadores.map((j) => `${esc(j.nome)} ${j.pontos}`).join("  ·  ")}</span>
    </div>

    <div class="card">
      <div class="chart" style="font-size:24px">${esc(sala.pergunta ?? "")}</div>
      <div class="fita">${Array.from({ length: 10 }, (_, i) =>
        `<div class="slot ${i < ditos.length ? "on" : ""}"></div>`).join("")}</div>
      <div style="font-size:10.5px;color:var(--dim);margin-top:6px">${ditos.length} de 10 lugares chutados</div>
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
            ? `<button class="bd" data-a="duvidar" style="width:100%;margin-top:14px" ${ocupado ? "disabled" : ""}>${ocupado ? "conferindo…" : "DUVIDO"}</button>`
            : `<p style="color:var(--dim);font-size:12px;margin-top:12px">Do seu palpite você não pode duvidar.</p>`}
      </div>` : ""}

    ${minhaVez ? `
      <div class="card" style="border-color:var(--amber)">
        <div class="eyebrow" style="color:var(--amber)">é com você</div>
        <input id="palpite" placeholder="Diga uma da lista" maxlength="40" autocomplete="off">
        <button class="b1" data-a="palpitar" style="margin-top:10px">Falar</button>
      </div>`
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
  const souHost = sala.host_id === eu.jogador_id;
  const foiDito = (resp) => (r.ditos ?? []).some((d) => norm(d.texto) === norm(resp));

  app.innerHTML = topo(true) + `
    ${r.tipo === "duvida" ? `
      <div class="card pop" style="border-color:${r.pos ? "var(--mint)" : "var(--pink)"}">
        <div class="eyebrow" style="color:${r.pos ? "var(--mint)" : "var(--pink)"}">
          ${r.pos ? "estava na lista" : "não estava na lista"}</div>
        <div class="chart" style="font-size:26px">${esc(r.palpite)}${
          r.pos ? ` <span style="color:var(--amber)">— ${r.pos}º</span>` : ""}</div>
        <div style="font-size:13px;color:var(--dim);margin-top:8px;line-height:1.5">
          ${esc(nomeDe(r.duvidador))} duvidou de ${esc(nomeDe(r.palpiteiro))}.
          <strong style="color:var(--paper)">+2 para ${esc(nomeDe(r.ganhador))}.</strong></div>
      </div>`
    : `<div class="card pop"><div class="eyebrow">dez palpites e ninguém duvidou</div>
         <div style="font-size:13px;color:var(--dim)">Rodada sem ponto para ninguém.</div></div>`}

    <div class="eyebrow">a lista de verdade</div>
    <div class="card" style="padding:10px 12px">
      ${(r.itens ?? []).map((it) => `
        <div style="display:flex;gap:10px;padding:5px 0;font-size:14px;color:${
          it.n === r.pos ? "var(--amber)" : foiDito(it.resposta) ? "var(--mint)" : "var(--paper)"}">
          <span class="chart" style="width:24px;text-align:right;color:var(--dim)">${it.n}</span>
          <span>${esc(it.resposta)}</span></div>`).join("")}
      ${r.criterio ? `<div style="font-size:10.5px;color:var(--dim);margin-top:8px;
        border-top:1px solid var(--edge);padding-top:8px">${esc(r.criterio)}</div>` : ""}
    </div>

    <div class="eyebrow">placar</div>
    <div class="card" style="padding:10px 12px">
      ${placar.map((j) => `<div class="linha"><span>${esc(j.nome)}</span>
        <span class="chart" style="color:var(--amber);font-size:18px">${j.pontos}</span></div>`).join("")}
    </div>

    ${fim
      ? `<div style="text-align:center">
           <div class="chart" style="font-size:30px;color:var(--amber)">${esc(placar[0].nome)} levou</div>
           <button class="b2" data-a="sair" style="margin-top:14px">Voltar ao início</button></div>`
      : souHost
        ? `<button class="b1" data-a="rodada" ${ocupado ? "disabled" : ""}>${ocupado ? "Virando carta…" : "Próxima rodada"}</button>`
        : `<p class="pulse" style="color:var(--dim);font-size:13px">Esperando ${esc(nomeDe(sala.host_id))} virar a próxima carta…</p>`}
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}`;
}

function render() {
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
  if (a === "rodada")  return novaRodada();
  if (a === "palpitar")return palpitar(document.getElementById("palpite").value.trim());
  if (a === "duvidar") return duvidar();
  if (a === "sair")    return sair();
  if (a === "copiar")  return navigator.clipboard?.writeText(location.href.split("?")[0]);
});

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
