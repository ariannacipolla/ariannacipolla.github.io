document.documentElement.classList.add("js");

/* =========================================================
   1. BADGE APPESO — fisica "verlet"
   Il laccio è una catena di punti collegati da segmenti di
   lunghezza fissa. Ogni frame: applichiamo la gravità, poi
   "correggiamo" le distanze tra i punti. Il badge è un corpo
   con due punti (foro in alto + fondo) così può oscillare.
   ========================================================= */
const stage = document.getElementById("stage"); // il posto del badge nella home
const layer = document.getElementById("badgeLayer"); // livello fisso dove vive il badge
const logo = document.querySelector(".logo");
const card = document.getElementById("card");
const cardTilt = document.getElementById("cardTilt");
const cardInner = document.getElementById("cardInner");
const egg = document.getElementById("egg");

const SEGMENTS = 10;
const GRAVITY = 2200;   // px/s²
const DAMPING = 0.985;  // attrito dell'aria (1 = nessun attrito)
const ITERATIONS = 12;  // più è alto, più il laccio è "rigido"
const HANG_Y = 14;      // distanza del foro (dove si aggancia il laccio) dal bordo alto del badge
const STRAP_W = 26;     // larghezza del laccio
const DOCK_SCALE = 0.15; // quanto diventa piccolo il badge in alto a sinistra
const MAX_FLIPS = 4;    // mezzi giri prima che il laccio si sbrogli (4 = 2 giri)

let anchor, baseSegLen, segLen, cardLen, rope, bottom;
let drag = null;
// 0 = badge nella home, 1 = badge riavvolto in alto a sinistra (segue lo scorrimento)
let dock = 0, reel = 1, homeRopeLen = 0, baseCardLen = 0, cardScale = 1, zipFrom = 0;
let pointer = null; // posizione del mouse, per l'effetto calamita

// Movimento "da fermo": una brezza leggera finché l'utente non tocca il badge
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let touched = false;
let simTime = 0;
let idle = 0;  // 0 = brezza spenta, 1 = accesa (cambia gradualmente)
let wind = 0;  // spinta verso il mouse, ammorbidita nel tempo
let tilt = 0;  // rotazione 3D, ammorbidita nel tempo

// Rotazione del badge (in gradi): ogni click aggiunge 180°, il laccio si attorciglia
let flips = 0;
let spin = 0;
let spinVel = 0;
let unwinding = false;

function point(x, y) {
    return { x, y, px: x, py: y };
}

// punto da cui pende il badge nella home (in coordinate della finestra)
function homeAnchor() {
    const r = stage.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top - 20 };
}

function setup(reset = true) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cardH = card.offsetHeight;

    anchor = homeAnchor();
    const ropeLen = Math.max(80, stage.clientHeight * 0.5 - cardH * 0.5);
    homeRopeLen = ropeLen;
    baseSegLen = segLen = ropeLen / SEGMENTS;
    baseCardLen = cardLen = cardH - HANG_Y;
    card.style.transformOrigin = `50% ${HANG_Y}px`;

    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    // L'easter egg sta al centro di dove si ferma il badge, così resta nascosto
    egg.style.left = `${stage.clientWidth * 0.5}px`;
    egg.style.top = `${-20 + ropeLen - HANG_Y + cardH / 2 - egg.offsetHeight / 2}px`;

    // Al ridimensionamento della finestra spostiamo solo l'ancora, senza ripartire
    if (!reset) return;

    // Se la pagina si apre già scorsa, il badge parte fermo e riavvolto
    updateDock();
    if (dock > 0.01) {
        rope = [];
        for (let i = 0; i <= SEGMENTS; i++) rope.push(point(anchor.x, anchor.y + i * segLen));
        const end = rope[SEGMENTS];
        bottom = point(end.x, end.y + cardLen);
        return;
    }

    // Partiamo spostati di lato così all'apertura il badge "cade" e oscilla
    rope = [];
    for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        rope.push(point(anchor.x + t * ropeLen * 0.7, anchor.y + t * ropeLen * 0.7));
    }
    const end = rope[SEGMENTS];
    bottom = point(end.x + cardLen * 0.5, end.y + cardLen * 0.8);
}

function constrain(a, b, len, aFixed, bFixed) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const diff = (dist - len) / dist;
    if (aFixed && bFixed) return;
    if (aFixed) {
        b.x -= dx * diff;
        b.y -= dy * diff;
    } else if (bFixed) {
        a.x += dx * diff;
        a.y += dy * diff;
    } else {
        a.x += dx * diff * 0.5;
        a.y += dy * diff * 0.5;
        b.x -= dx * diff * 0.5;
        b.y -= dy * diff * 0.5;
    }
}

function step(dt) {
    const end = rope[SEGMENTS];
    const moving = [...rope.slice(1), bottom];

    for (const p of moving) {
        if (drag && p === end) continue;
        // durante il viaggio verso l'angolo l'aria è più "densa": niente rimbalzi
        const damp = DAMPING - 0.06 * Math.min(1, Math.abs(dockTarget - dock) * 8);
        const vx = (p.x - p.px) * damp;
        const vy = (p.y - p.py) * damp;
        p.px = p.x;
        p.py = p.y;
        p.x += vx;
        p.y += vy + GRAVITY * dt * dt;
    }

    // Tutte le forze cambiano in modo graduale, così il movimento resta fluido
    simTime += dt;
    const idleTarget = !touched && !reduceMotion && simTime > 2.5 ? 1 : 0;
    idle += (idleTarget - idle) * Math.min(1, dt * 0.6);

    // Effetto calamita: se il mouse è vicino, il badge si piega piano verso di lui
    let windTarget = 0;
    if (pointer && !drag) {
        const cx = (end.x + bottom.x) / 2;
        const cy = (end.y + bottom.y) / 2;
        const dx = pointer.x - cx;
        const falloff = Math.max(0, 1 - Math.hypot(dx, pointer.y - cy) / 360);
        windTarget = Math.max(-1, Math.min(1, dx / 220)) * falloff;
    }
    wind += (windTarget - wind) * Math.min(1, dt * 2.5);

    const breeze = idle * 0.4 * Math.sin(simTime * 1.1);
    if (!drag) bottom.x += (wind + breeze) * 650 * dt * dt;

    if (drag) {
        // Il laccio non si allunga: limitiamo la distanza dall'ancora
        let tx = drag.x, ty = drag.y;
        const dx = tx - anchor.x, dy = ty - anchor.y;
        const max = segLen * SEGMENTS * 1.02;
        const d = Math.hypot(dx, dy);
        if (d > max) {
            tx = anchor.x + (dx / d) * max;
            ty = anchor.y + (dy / d) * max;
        }
        end.px = end.x;
        end.py = end.y;
        end.x = tx;
        end.y = ty;
    }

    for (let k = 0; k < ITERATIONS; k++) {
        rope[0].x = anchor.x;
        rope[0].y = anchor.y;
        for (let i = 0; i < SEGMENTS; i++) {
            constrain(rope[i], rope[i + 1], segLen, i === 0, drag && i + 1 === SEGMENTS);
        }
        constrain(end, bottom, cardLen, !!drag, false);
    }
}

/* ---------- Girare il badge e attorcigliare il laccio ----------
   La rotazione segue una "molla": arriva morbida al valore richiesto.
   Quando si sbroglia la molla è più lenta e il badge gira su se stesso. */
function flip() {
    touched = true;
    if (unwinding) return;
    if (flips < MAX_FLIPS) {
        flips++;
    } else {
        flips = 0;
        unwinding = true;
    }
}

function updateSpin(dt) {
    const k = unwinding ? 9 : 70;
    const damping = 2 * (unwinding ? 0.8 : 1) * Math.sqrt(k);
    spinVel += (k * (flips * 180 - spin) - damping * spinVel) * dt;
    spin += spinVel * dt;
    if (unwinding && Math.abs(spin) < 2 && Math.abs(spinVel) < 20) unwinding = false;
    // Più è attorcigliato, più il laccio si accorcia un po'
    // (e il riavvolgimento dello scorrimento lo accorcia del tutto)
    segLen = baseSegLen * reel * (1 - 0.025 * Math.abs(spin) / 360);
}

// Punti intermedi lungo il laccio (curva Catmull-Rom), per disegnarlo liscio
function smoothRope(sub) {
    const pts = [];
    for (let i = 0; i < SEGMENTS; i++) {
        const p0 = rope[Math.max(i - 1, 0)], p1 = rope[i];
        const p2 = rope[i + 1], p3 = rope[Math.min(i + 2, SEGMENTS)];
        for (let j = 0; j < sub; j++) {
            const t = j / sub, t2 = t * t, t3 = t2 * t;
            const f = (a, b, c, d) =>
                0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
            pts.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
        }
    }
    pts.push({ x: rope[SEGMENTS].x, y: rope[SEGMENTS].y });
    return pts;
}

const canvas = document.getElementById("lanyard");
const ctx = canvas.getContext("2d");
let dpr = 1;

const FABRIC = {
    front: { dark: [14, 25, 62], bright: [52, 84, 168] },  // blu
    back: { dark: [9, 17, 44], bright: [33, 54, 116] },    // retro, più scuro
};

function shade(rgb, k) {
    return `rgb(${rgb.map((v) => Math.min(255, Math.round(v * k))).join(",")})`;
}

function renderStrap() {
    const w = canvas.width / dpr, h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Il laccio è fermo in alto e ruota insieme al badge in basso:
    // la torsione cresce lungo il nastro, che si stringe dove è di taglio
    const pts = smoothRope(8);
    const n = pts.length;
    let total = 0;
    pts.forEach((p, k) => {
        if (k) total += Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y);
        p.s = total;
    });
    const twist = ((spin + tilt) * Math.PI) / 180;
    const edges = pts.map((p, k) => {
        const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, n - 1)];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        const phi = twist * (p.s / total);
        const c = Math.cos(phi);
        const sw = STRAP_W * (1 - 0.75 * dock); // il nastro si assottiglia con il badge
        const hw = (c < 0 ? -1 : 1) * Math.max(Math.abs(c) * sw / 2, 0.9);
        // Luce da in alto a sinistra: più chiaro quando il nastro la guarda
        const side = c >= 0 ? 1 : -1;
        const light = Math.max(0, Math.min(1, side * (0.85 * c - 0.5 * Math.sin(phi))));
        return { ...p, c, light, nx, ny, hw };
    });
    const at = (e, u) => ({ x: e.x + e.nx * e.hw * (1 - 2 * u), y: e.y + e.ny * e.hw * (1 - 2 * u) });
    const fabricEnd = n - 1;

    // 1. Ombra morbida del nastro sulla pagina
    ctx.save();
    ctx.shadowColor = "rgba(28, 42, 85, 0.3)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = "rgb(20, 32, 70)";
    ctx.beginPath();
    for (let k = 0; k <= fabricEnd; k++) ctx.lineTo(at(edges[k], 0).x, at(edges[k], 0).y);
    for (let k = fabricEnd; k >= 0; k--) ctx.lineTo(at(edges[k], 1).x, at(edges[k], 1).y);
    ctx.fill();
    ctx.restore();

    // 2. Il tessuto: ogni pezzo ha una sfumatura sulla larghezza
    //    (bordi più scuri, centro più chiaro) che lo fa sembrare incurvato
    for (let k = 0; k < fabricEnd; k++) {
        const e = edges[k], f = edges[k + 1];
        const tone = e.c + f.c >= 0 ? FABRIC.front : FABRIC.back;
        const light = (e.light + f.light) / 2;
        const base = tone.dark.map((v, i) => v + (tone.bright[i] - v) * light);
        const l = at(e, 0), r = at(e, 1);
        const grad = ctx.createLinearGradient(l.x, l.y, r.x, r.y);
        grad.addColorStop(0, shade(base, 0.72));
        grad.addColorStop(0.18, shade(base, 0.95));
        grad.addColorStop(0.45, shade(base, 1.08));
        grad.addColorStop(0.82, shade(base, 0.95));
        grad.addColorStop(1, shade(base, 0.7));
        ctx.fillStyle = grad;
        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        const p1 = at(e, 0), p2 = at(f, 0), p3 = at(f, 1), p4 = at(e, 1);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    // 3. Cuciture lungo i bordi, visibili solo dove il nastro è aperto
    ctx.save();
    ctx.setLineDash([3, 2.2]);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(225, 232, 255, 0.28)";
    for (const u of [0.13, 0.87]) {
        ctx.beginPath();
        let drawing = false;
        for (let k = 0; k <= fabricEnd; k++) {
            const e = edges[k];
            if (Math.abs(e.c) < 0.45) {
                drawing = false;
                continue;
            }
            const p = at(e, u);
            drawing ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
            drawing = true;
        }
        ctx.stroke();
    }
    ctx.restore();
}

function render() {
    const end = rope[SEGMENTS];

    // Badge: posizione del foro + rotazione data dal punto in basso
    const angle = Math.atan2(bottom.x - end.x, bottom.y - end.y);
    // Rotazione 3D: segue la velocità + una lenta rotazione che mostra il retro
    const vx = end.x - end.px;
    const tiltTarget = Math.max(-20, Math.min(20, vx * 2.5)) + idle * 22 * Math.sin(simTime * 0.6);
    tilt += (tiltTarget - tilt) * 0.08;
    card.style.transform =
        `translate(${end.x - card.offsetWidth / 2}px, ${end.y - HANG_Y}px) rotate(${-angle}rad) scale(${cardScale})`;
    cardTilt.style.transform = `rotateY(${tilt}deg)`;
    cardInner.style.transform = `rotateY(${spin}deg)`;
    renderStrap();
    drawZip();
}

/* ---------- La zip dello scorrimento ----------
   Scorrendo, l'aggancio del cordino scorre verso sinistra lungo il bordo
   alto della pagina come il cursore di una cerniera: cordino e badge lo
   seguono rimpicciolendosi, fino a fermarsi in alto a sinistra al posto
   del logo. Tornando su, la zip si riapre e il badge torna grande. */
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerpN = (a, b, t) => a + (b - a) * t;

let dockTarget = 0;
// su telefono il badge non va nell'angolo: resta nella home e scorre via con la pagina
const noDock = window.matchMedia("(max-width: 800px)");
function updateDock(dt) {
    const range = document.getElementById("home").offsetHeight * 0.6;
    const p = Math.max(0, Math.min(1, window.scrollY / range));
    dockTarget = noDock.matches ? 0 : easeInOut(p);
    // il badge insegue lo scorrimento con calma: anche se si scorre veloce, non salta
    const prevDock = dock;
    dock = dt === undefined || reduceMotion ? dockTarget : dock + (dockTarget - dock) * (1 - Math.exp(-dt * 5));
    if (Math.abs(dockTarget - dock) < 0.0005) dock = dockTarget;

    // il cursore della zip resta sul bordo alto della finestra e scorre verso il logo
    const home = homeAnchor();
    const L = logo.getBoundingClientRect();
    zipFrom = home.x;
    const railY = dock < 0.001 ? home.y : lerpN(Math.max(home.y, -20), 4, Math.min(1, dock * 1.6));
    const next = { x: lerpN(home.x, L.left + L.width / 2, dock), y: railY };

    // il cordino non si riavvolge: si rimpicciolisce insieme al badge
    const prevReel = reel, prevScale = cardScale;
    reel = lerpN(1, 0.16, dock);
    segLen = baseSegLen * reel * (1 - 0.025 * Math.abs(spin) / 360);
    cardScale = lerpN(1, DOCK_SCALE, dock);
    cardLen = baseCardLen * cardScale;

    // Spostamento e rimpicciolimento "trasportano" cordino e badge invece di strattonarli:
    // muoviamo anche le posizioni precedenti, così la fisica non riceve velocità extra
    // e resta solo un leggero dondolio.
    if (anchor && rope && dt !== undefined && (prevDock !== dock || next.x !== anchor.x || next.y !== anchor.y)) {
        const k = prevReel > 0 ? reel / prevReel : 1;
        const kc = prevScale > 0 ? cardScale / prevScale : 1;
        const end = rope[SEGMENTS];
        const oldEnd = { x: end.x, y: end.y }, oldEndP = { x: end.px, y: end.py };
        const carry = (q, kk, o, oN) => {
            q.x = oN.x + (q.x - o.x) * kk;
            q.y = oN.y + (q.y - o.y) * kk;
            q.px = oN.x + (q.px - o.x) * kk;
            q.py = oN.y + (q.py - o.y) * kk;
        };
        if (!drag) rope.forEach((q) => carry(q, k, anchor, next));
        // il badge segue il suo gancio e si accorcia con la stessa proporzione
        const newEnd = rope[SEGMENTS];
        bottom.x = newEnd.x + (bottom.x - oldEnd.x) * kc;
        bottom.y = newEnd.y + (bottom.y - oldEnd.y) * kc;
        bottom.px = newEnd.px + (bottom.px - oldEndP.x) * kc;
        bottom.py = newEnd.py + (bottom.py - oldEndP.y) * kc;
        // il fondo del badge resta un filo indietro: ne nasce un dondolio morbido
        const lag = 0.005;
        bottom.x -= (newEnd.x - oldEnd.x) * lag;
        bottom.y -= (newEnd.y - oldEnd.y) * lag;
    }
    anchor = next;

    egg.style.visibility = p > 0.01 ? "hidden" : "";
    // su telefono il logo sparisce scorrendo, così non resta sopra i titoli
    const fade = noDock.matches ? p : dock;
    logo.style.opacity = 1 - Math.min(1, fade * 2.5);
    logo.style.pointerEvents = fade > 0.4 ? "none" : "";
    card.classList.toggle("docked", dock > 0.95);
}

// la zip: i dentini compaiono dietro il cursore mentre scorre, poi spariscono
function drawZip() {
    if (dock < 0.01) return;
    const y = anchor.y;
    const trail = Math.min(1, dock * 5) * (1 - dock); // visibile solo durante il viaggio
    if (trail > 0.01) {
        ctx.fillStyle = `rgba(42, 71, 144, ${0.75 * trail})`;
        for (let x = anchor.x + 8, k = 0; x < zipFrom; x += 5, k++) {
            ctx.fillRect(x, y + (k % 2 ? -1 : -4), 3.2, 4);
        }
    }
    // il cursore
    const w = lerpN(22, 12, dock), h = lerpN(12, 8, dock);
    ctx.fillStyle = "#2a4790";
    ctx.beginPath();
    ctx.roundRect(anchor.x - w / 2, y - h / 2, w, h, 3);
    ctx.fill();
    ctx.fillStyle = "#d2477b";
    ctx.beginPath();
    ctx.arc(anchor.x, y, Math.max(1.5, h * 0.22), 0, Math.PI * 2);
    ctx.fill();
}

function goHome() {
    if (window.smoothScrollTo) window.smoothScrollTo(0);
    else window.scrollTo(0, 0);
}

let last = performance.now();
function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    // Passi fissi piccoli = simulazione stabile
    const sub = 3;
    for (let i = 0; i < sub; i++) {
        updateDock(dt / sub);
        updateSpin(dt / sub);
        step(dt / sub);
    }
    render();
    requestAnimationFrame(loop);
}

/* ---------- Trascinare e girare il badge ---------- */
function localPos(e) {
    const r = layer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

card.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // niente selezione del testo mentre si trascina
    const p = localPos(e);
    const end = rope[SEGMENTS];
    drag = {
        offX: p.x - end.x,
        offY: p.y - end.y,
        x: end.x,
        y: end.y,
        startX: e.clientX,
        startY: e.clientY,
        moved: 0,
    };
    card.setPointerCapture(e.pointerId);
    card.classList.add("dragging");
    document.body.classList.add("is-dragging");
    touched = true;
});

window.addEventListener("pointermove", (e) => {
    pointer = e.pointerType === "mouse" ? localPos(e) : null;
});
document.addEventListener("pointerleave", () => (pointer = null));

card.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = localPos(e);
    drag.x = p.x - drag.offX;
    drag.y = p.y - drag.offY;
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY));
});

function release() {
    if (!drag) return;
    // Se il puntatore si è mosso pochissimo è un click: giriamo il badge
    // (quando è riavvolto in alto a sinistra, invece, riporta alla home)
    if (drag.moved < 6) dock > 0.95 ? goHome() : flip();
    drag = null;
    card.classList.remove("dragging");
    document.body.classList.remove("is-dragging");
}
card.addEventListener("pointerup", release);
card.addEventListener("pointercancel", release);

card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        flip();
    }
});

// Su telefono la barra degli indirizzi cambia l'altezza mentre scorri:
// in quel caso ridimensioniamo solo la tela, senza toccare il cordino
let lastW = window.innerWidth;
window.addEventListener("resize", () => {
    if (window.innerWidth === lastW) {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        return;
    }
    lastW = window.innerWidth;
    setup(false);
});
// La scritta compare solo quando il badge ha finito di entrare
setTimeout(() => egg.classList.add("show"), 3500);
setup();
requestAnimationFrame(loop);

/* =========================================================
   2. TITOLO CHE SI SCRIVE DA SOLO
   ========================================================= */
const words = ["see", "track", "detect", "reason"];
const typed = document.getElementById("typed");
let wordIndex = 0;
let charIndex = words[0].length;
let deleting = true;

function type() {
    if (deleting) {
        charIndex--;
        if (charIndex === 0) {
            deleting = false;
            wordIndex = (wordIndex + 1) % words.length;
        }
    } else {
        charIndex++;
        if (charIndex === words[wordIndex].length) {
            deleting = true;
            typed.textContent = words[wordIndex];
            return setTimeout(type, 2200);
        }
    }
    typed.textContent = words[wordIndex].slice(0, charIndex) || "​";
    setTimeout(type, deleting ? 60 : 110);
}
setTimeout(type, 2200);

/* =========================================================
   3. MENU IN BASSO: evidenzia la sezione visibile
   ========================================================= */
const navLinks = document.querySelectorAll(".pill-nav a");
const observer = new IntersectionObserver(
    (entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            navLinks.forEach((a) =>
                a.classList.toggle("active", a.getAttribute("href") === "#" + entry.target.id)
            );
        }
    },
    { rootMargin: "-45% 0px -45% 0px" }
);
document.querySelectorAll("section[id]").forEach((s) => observer.observe(s));

// sopra il blocco blu dei contatti il menu passa ai colori invertiti
const pillNav = document.querySelector(".pill-nav");
const contactBlock = document.querySelector("#contact");
function navOnBlue() {
    pillNav.classList.toggle("on-blue", contactBlock.getBoundingClientRect().top < window.innerHeight - 50);
}
window.addEventListener("scroll", navOnBlue, { passive: true });
navOnBlue();

/* =========================================================
   4. COMPARSA DEGLI ELEMENTI MENTRE SI SCORRE
   ========================================================= */
const revealObserver = new IntersectionObserver(
    (entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("in");
            revealObserver.unobserve(entry.target);
        }
    },
    { rootMargin: "0px 0px -10% 0px" }
);
document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

/* =========================================================
   5. DEMO DI COMPUTER VISION (esperienza Energee4)
   Un campo da padel visto da una sola telecamera: due giocatori
   con lo scheletro della posa, la pallina con la sua traiettoria,
   i rimbalzi e il tipo di colpo, come l'output della pipeline.
   ========================================================= */
const cvCanvas = document.getElementById("cvDemo");
if (cvCanvas) {
    const g = cvCanvas.getContext("2d");
    const CREAM = "#f5f3ec";
    const PINK = "#d2477b";
    const SHOTS = ["forehand", "backhand", "volley", "lob", "smash"];
    let W = 0, H = 0, running = false;

    const rand = (a, b) => a + Math.random() * (b - a);
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp01 = (t) => Math.max(0, Math.min(1, t));
    const ease = (t) => t * t * (3 - 2 * t);

    function sizeDemo() {
        const r = cvCanvas.getBoundingClientRect();
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        W = r.width;
        H = r.height;
        cvCanvas.width = W * ratio;
        cvCanvas.height = H * ratio;
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    // Prospettiva: cx = posizione in larghezza (0..1), cz = profondità (0 lontano, 1 vicino)
    const scaleAt = (cz) => 0.42 + 0.58 * cz;
    function project(cx, cz, h = 0) {
        const half = W * (0.17 + 0.25 * cz);
        return {
            x: W / 2 + (cx - 0.5) * 2 * half,
            y: H * (0.26 + 0.62 * cz) - h * H * 0.085 * scaleAt(cz),
        };
    }

    // Uno scambio: chi colpisce, dove rimbalza, dove arriva l'altro giocatore
    function makeShot(fromNear, t0, fromCx) {
        const from = { cx: fromCx, cz: fromNear ? 0.95 : 0.07 };
        const bounce = { cx: rand(0.25, 0.75), cz: fromNear ? rand(0.16, 0.3) : rand(0.7, 0.84) };
        const next = { cx: rand(0.3, 0.7), cz: fromNear ? 0.07 : 0.95 };
        return { fromNear, t0, from, bounce, next, tBounce: t0 + 0.62, tHit: t0 + 1.12, bounced: false };
    }

    let shot, shotName, trail, bounces, players;
    function resetDemo(t) {
        shot = makeShot(true, t, 0.5);
        shotName = "serve";
        trail = [];
        bounces = [];
        players = { near: { cx: 0.5, v: 0 }, far: { cx: 0.5, v: 0 } };
    }

    function ballAt(t) {
        if (t < shot.tBounce) {
            const u = (t - shot.t0) / (shot.tBounce - shot.t0);
            return {
                cx: lerp(shot.from.cx, shot.bounce.cx, u),
                cz: lerp(shot.from.cz, shot.bounce.cz, u),
                h: lerp(1, 0, u) + 4 * 1.5 * u * (1 - u),
            };
        }
        const u = (t - shot.tBounce) / (shot.tHit - shot.tBounce);
        return {
            cx: lerp(shot.bounce.cx, shot.next.cx, u),
            cz: lerp(shot.bounce.cz, shot.next.cz, u),
            h: lerp(0, 1, u) + 4 * 0.8 * u * (1 - u),
        };
    }

    // Angolo del braccio con la racchetta, rispetto al momento del colpo (dt in secondi)
    function armAngle(dt) {
        const ready = -0.35, back = -2.3, follow = 1.5;
        if (dt < -0.45) return ready;
        if (dt < -0.1) return lerp(ready, back, ease((dt + 0.45) / 0.35));
        if (dt < 0.12) return lerp(back, follow, ease((dt + 0.1) / 0.22));
        if (dt < 0.6) return lerp(follow, ready, ease((dt - 0.12) / 0.48));
        return ready;
    }

    function line(a, b) {
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
    }

    function drawPlayer(p, cz, dt, side, t) {
        const feet = project(p.cx, cz);
        const s = H * 0.3 * scaleAt(cz);
        const run = Math.min(1, p.v * 6) * Math.sin(t * 14);
        const P = (x, y) => ({ x: feet.x + x * s, y: feet.y - y * s });

        const a = armAngle(dt);
        const sh = { x: 0.12 * side, y: 0.78 };
        const el = { x: sh.x + 0.16 * Math.sin(a) * side, y: sh.y - 0.16 * Math.cos(a) };
        const a2 = a + 0.35;
        const wr = { x: el.x + 0.15 * Math.sin(a2) * side, y: el.y - 0.15 * Math.cos(a2) };
        const rk = { x: wr.x + 0.2 * Math.sin(a2) * side, y: wr.y - 0.2 * Math.cos(a2) };

        const k = {
            head: P(0, 0.92), neck: P(0, 0.8),
            shR: P(sh.x, sh.y), elR: P(el.x, el.y), wrR: P(wr.x, wr.y),
            shL: P(-0.12 * side, 0.78), elL: P(-0.17 * side, 0.62), wrL: P(-0.11 * side, 0.52 + 0.02 * Math.sin(t * 3)),
            hipR: P(0.07 * side, 0.5), hipL: P(-0.07 * side, 0.5),
            knR: P(0.09 * side + run * 0.05, 0.26), knL: P(-0.09 * side - run * 0.05, 0.26),
            anR: P(0.11 * side + run * 0.08, 0), anL: P(-0.11 * side - run * 0.08, 0),
        };
        const racket = P(rk.x, rk.y);

        // riquadro di detection
        const xs = Object.values(k).map((q) => q.x).concat(racket.x);
        const ys = Object.values(k).map((q) => q.y).concat(racket.y);
        // riquadro di detection: solo quattro angolini discreti
        const pad = s * 0.07;
        const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
        const x1 = Math.max(...xs) + pad, y1 = Math.max(...ys) + pad;
        const c = Math.min(10, (x1 - x0) * 0.25);
        g.strokeStyle = "rgba(245, 243, 236, 0.45)";
        g.lineWidth = 1;
        g.beginPath();
        for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
            g.moveTo(x + dx * c, y);
            g.lineTo(x, y);
            g.lineTo(x, y + dy * c);
        }
        g.stroke();

        // ossa dello scheletro
        g.strokeStyle = CREAM;
        g.lineCap = "round";
        g.lineWidth = Math.max(1.5, s * 0.022);
        [
            ["neck", "shR"], ["neck", "shL"], ["shR", "elR"], ["elR", "wrR"], ["shL", "elL"], ["elL", "wrL"],
            ["shR", "hipR"], ["shL", "hipL"], ["hipR", "hipL"], ["hipR", "knR"], ["knR", "anR"],
            ["hipL", "knL"], ["knL", "anL"], ["neck", "head"],
        ].forEach(([a, b]) => line(k[a], k[b]));

        // racchetta
        g.lineWidth = Math.max(1, s * 0.014);
        line(k.wrR, racket);
        g.beginPath();
        g.ellipse(racket.x, racket.y, s * 0.045, s * 0.06, Math.atan2(racket.y - k.wrR.y, racket.x - k.wrR.x) + Math.PI / 2, 0, Math.PI * 2);
        g.stroke();

        // giunture
        for (const [name, q] of Object.entries(k)) {
            g.fillStyle = name === "head" ? CREAM : PINK;
            g.beginPath();
            g.arc(q.x, q.y, name === "head" ? s * 0.05 : Math.max(2, s * 0.016), 0, Math.PI * 2);
            g.fill();
        }
    }

    function drawCourt() {
        g.strokeStyle = "rgba(245, 243, 236, 0.4)";
        g.lineWidth = 1;
        const c = (cx, cz) => project(cx, cz);
        g.beginPath();
        [c(0, 0), c(1, 0), c(1, 1), c(0, 1)].forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.closePath();
        g.stroke();
        line(c(0, 0.3), c(1, 0.3));
        line(c(0, 0.7), c(1, 0.7));
        line(c(0.5, 0.3), c(0.5, 0.7));
    }

    function drawNet() {
        const a = project(-0.03, 0.5), b = project(1.03, 0.5);
        const at = project(-0.03, 0.5, 0.9), bt = project(1.03, 0.5, 0.9);
        g.fillStyle = "rgba(245, 243, 236, 0.07)";
        g.beginPath();
        [a, b, bt, at].forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.fill();
        g.strokeStyle = "rgba(245, 243, 236, 0.7)";
        g.lineWidth = 1.5;
        line(at, bt);
    }

    function drawBall(b) {
        const p = project(b.cx, b.cz, b.h);
        const r = 2.5 + 3 * scaleAt(b.cz);
        // scia della traiettoria
        trail.forEach((q, i) => {
            g.fillStyle = `rgba(210, 71, 123, ${(i / trail.length) * 0.9})`;
            g.beginPath();
            g.arc(q.x, q.y, Math.max(1, r * 0.55 * (i / trail.length)), 0, Math.PI * 2);
            g.fill();
        });
        g.fillStyle = PINK;
        g.strokeStyle = CREAM;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        g.fill();
        g.stroke();
    }

    function drawFrame(t, dt) {
        g.clearRect(0, 0, W, H);

        // nuovo colpo quando la pallina arriva all'altro giocatore
        while (t >= shot.tHit) {
            const fromNear = !shot.fromNear;
            shot = makeShot(fromNear, shot.tHit, shot.next.cx);
            shotName = SHOTS[Math.floor(Math.random() * SHOTS.length)];
        }
        if (!shot.bounced && t >= shot.tBounce) {
            shot.bounced = true;
            bounces.push({ ...shot.bounce, t });
        }
        bounces = bounces.filter((b) => t - b.t < 0.9);

        const ball = ballAt(t);
        const bp = project(ball.cx, ball.cz, ball.h);
        trail.push(bp);
        if (trail.length > 22) trail.shift();

        // i giocatori seguono la pallina
        const toNear = !shot.fromNear;
        const targets = { near: toNear ? shot.next.cx : 0.5, far: toNear ? 0.5 : shot.next.cx };
        for (const side of ["near", "far"]) {
            const p = players[side];
            const step = (targets[side] - p.cx) * Math.min(1, dt * 3.5);
            p.cx += step;
            p.v = lerp(p.v, Math.abs(step) / Math.max(dt, 0.001) * 0.05, 0.2);
        }

        drawCourt();

        // rimbalzi: un anello che si allarga sul campo
        for (const b of bounces) {
            const u = (t - b.t) / 0.9;
            const c = project(b.cx, b.cz);
            const sc = scaleAt(b.cz);
            g.strokeStyle = `rgba(210, 71, 123, ${1 - u})`;
            g.lineWidth = 2;
            g.beginPath();
            g.ellipse(c.x, c.y, (6 + 22 * u) * sc, (2.5 + 8 * u) * sc, 0, 0, Math.PI * 2);
            g.stroke();
        }

        // ombra della pallina a terra
        const sp = project(ball.cx, ball.cz);
        g.fillStyle = "rgba(10, 20, 50, 0.35)";
        g.beginPath();
        g.ellipse(sp.x, sp.y, 5 * scaleAt(ball.cz), 2 * scaleAt(ball.cz), 0, 0, Math.PI * 2);
        g.fill();

        const nearHit = shot.fromNear ? shot.t0 : shot.tHit;
        const farHit = shot.fromNear ? shot.tHit : shot.t0;
        drawPlayer(players.far, 0.07, t - farHit, -1, t);
        if (ball.cz < 0.5) drawBall(ball);
        drawNet();
        if (ball.cz >= 0.5) drawBall(ball);
        drawPlayer(players.near, 0.95, t - nearHit, 1, t);

        // un'unica scritta: il tipo di colpo riconosciuto
        g.font = '500 10px "IBM Plex Mono", monospace';
        g.fillStyle = "rgba(245, 243, 236, 0.75)";
        const shotText = shotName.toUpperCase();
        g.fillText(shotText, W - 18 - g.measureText(shotText).width, H - 18);
    }

    let lastT = 0;
    function demoLoop() {
        if (!running) return;
        const t = performance.now() / 1000;
        drawFrame(t, Math.min(0.05, t - lastT));
        lastT = t;
        requestAnimationFrame(demoLoop);
    }

    sizeDemo();
    window.addEventListener("resize", sizeDemo);

    if (reduceMotion) {
        // nessuna animazione: mostriamo un solo fotogramma
        resetDemo(0);
        drawFrame(0.35, 0.016);
    } else {
        // l'animazione gira solo quando il riquadro è visibile
        new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting && !running) {
                running = true;
                lastT = performance.now() / 1000;
                resetDemo(lastT);
                requestAnimationFrame(demoLoop);
            } else if (!entry.isIntersecting) {
                running = false;
            }
        }).observe(cvCanvas);
    }
}

/* =========================================================
   6. TITOLI DELLE SEZIONI CHE SI SCRIVONO DA SOLI
   Come il titolo della home: compaiono lettera per lettera
   con il cursore quando si arriva alla sezione.
   ========================================================= */
document.querySelectorAll(".type-title").forEach((title) => {
    const text = title.textContent;
    title.setAttribute("aria-label", text);
    title.style.minHeight = `${title.offsetHeight}px`; // niente salti mentre si scrive
    const out = document.createElement("span");
    out.setAttribute("aria-hidden", "true");
    const caret = document.createElement("span");
    caret.className = "caret";
    title.replaceChildren(out, caret);

    if (reduceMotion) {
        out.textContent = text;
        return;
    }
    new IntersectionObserver((entries, obs) => {
        if (!entries[0].isIntersecting) return;
        obs.disconnect();
        let i = 0;
        const tick = () => {
            out.textContent = text.slice(0, ++i);
            if (i < text.length) setTimeout(tick, 90);
        };
        setTimeout(tick, 250);
    }, { rootMargin: "0px 0px -15% 0px" }).observe(title);
});

/* =========================================================
   7. MINI CHAT NEI CONTATTI
   Non c'è un server: quando si invia, si apre l'app di posta
   con l'email già compilata.
   ========================================================= */
const chat = document.getElementById("chat");
if (chat) {
    const log = document.getElementById("chatLog");
    const chips = document.getElementById("chatChips");
    const form = document.getElementById("chatForm");
    const input = document.getElementById("chatInput");
    const EMAIL = "ariannacipolla2002@gmail.com";
    const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms));
    let topic = "Hello from your portfolio";

    function bubble(text, me = false) {
        const m = document.createElement("p");
        m.className = me ? "msg me" : "msg";
        m.textContent = text;
        log.appendChild(m);
        return m;
    }

    // Arianna "sta scrivendo", poi compare il messaggio
    async function say(text) {
        const t = document.createElement("p");
        t.className = "msg typing";
        t.innerHTML = "<i></i><i></i><i></i>";
        log.appendChild(t);
        await wait(700 + text.length * 12);
        t.remove();
        bubble(text);
        await wait(250);
    }

    const OPTIONS = [
        ["Networking advice", "Networking advice", "Ask me anything ↓"],
        ["Something interesting", "Something interesting to talk about", "I'm all ears ↓"],
        ["Just say hi", "Just saying hi", "Hi back! Write me a line ↓"],
    ];

    async function start() {
        await say("Hi, I'm Arianna 👋");
        await say("You don't need a job offer to write me.");
        await say("Networking advice, a cool idea, or just to meet someone new: all welcome.");
        OPTIONS.forEach(([label, subject, reply]) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = label;
            b.addEventListener("click", async () => {
                chips.replaceChildren();
                topic = subject;
                bubble(label, true);
                await say(reply);
                input.focus({ preventScroll: true });
            });
            chips.appendChild(b);
        });
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return input.focus();
        chips.replaceChildren();
        bubble(text, true);
        input.value = "";
        await say("Opening your email app, just hit send ✉️");
        window.location.href =
            `mailto:${EMAIL}?subject=${encodeURIComponent(topic)}&body=${encodeURIComponent(text)}`;
    });

    // la conversazione parte quando la chat entra nello schermo
    new IntersectionObserver((entries, obs) => {
        if (!entries[0].isIntersecting) return;
        obs.disconnect();
        start();
    }, { rootMargin: "0px 0px -10% 0px" }).observe(chat);
}

/* =========================================================
   8. GALLERIA: foto a schermo intero e video che partono da soli
   ========================================================= */
const lightbox = document.getElementById("lightbox");
document.querySelectorAll(".print img").forEach((img) => {
    img.addEventListener("click", () => {
        lightbox.querySelector("img").src = img.src;
        lightbox.querySelector("img").alt = img.alt;
        lightbox.hidden = false;
    });
});
lightbox.addEventListener("click", () => (lightbox.hidden = true));
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") lightbox.hidden = true;
});

document.querySelectorAll(".reel").forEach((reel) => {
    const video = reel.querySelector("video");
    const sound = reel.querySelector(".reel-sound");

    // parte (senza audio) solo quando è visibile, si ferma quando esce dallo schermo
    if (!reduceMotion) {
        new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) video.play().catch(() => {});
            else video.pause();
        }, { threshold: 0.5 }).observe(video);
    }

    sound.addEventListener("click", () => {
        const on = video.muted;
        // un solo video con l'audio alla volta
        document.querySelectorAll(".reel video").forEach((v) => (v.muted = true));
        document.querySelectorAll(".reel-sound").forEach((b) => {
            b.classList.remove("on");
            b.textContent = "Sound off";
            b.setAttribute("aria-label", "Turn sound on");
        });
        if (on) {
            video.muted = false;
            video.play().catch(() => {});
            sound.classList.add("on");
            sound.textContent = "Sound on";
            sound.setAttribute("aria-label", "Turn sound off");
        }
    });
});

/* =========================================================
   9. EASTER EGG PER CHI APRE IL CODICE
   ========================================================= */
console.log(
    "%cHey, curious mind 👀",
    "font: 700 20px Anton, Impact, sans-serif; color: #d2477b;"
);
console.log(
    "%cYou're reading the source code. That's exactly my kind of person.\nSay hi → ariannacipolla2002@gmail.com",
    "font: 12px 'IBM Plex Mono', monospace; color: #2a4790;"
);

/* =========================================================
   11. IL FILO TRA ENERGEE4 E LA TESI MAGISTRALE
   Una curva un po' lenta tra i due pallini: il punto centrale segue
   una molla, così quando i fogli si muovono il filo ondeggia e si assesta.
   ========================================================= */
const thread = document.getElementById("thread");
if (thread) {
    const path = thread.querySelector("path");
    const sheetsBox = thread.parentElement;
    const dotA = document.querySelector(".sheet-feature .corner.bl");
    const dotB = document.querySelector(".sheet-linked .corner.tl");
    let bend = 0, bendVel = 0, lastMid = null, visible = false, t0 = performance.now();

    const center = (el, box) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    };

    function drawThread(now) {
        const box = sheetsBox.getBoundingClientRect();
        const a = center(dotA, box), b = center(dotB, box);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

        // la spinta arriva dal movimento dei fogli; da fermo resta un leggero ondeggiare
        if (lastMid) {
            const push = (mid.x - lastMid.x + mid.y - lastMid.y) * 1.6;
            bendVel -= Math.max(-3, Math.min(3, push)); // spinte morbide, anche se la pagina "salta"
        }
        lastMid = mid;
        const idle = reduceMotion ? 0 : Math.sin((now - t0) / 900) * 2.5;
        const target = 7 + idle; // il filo è un po' lento: pende sempre di qualche pixel
        bendVel += (target - bend) * 0.08;
        bendVel *= 0.88;
        bend = Math.max(-6, Math.min(18, bend + bendVel));

        // curva perpendicolare al segmento tra i due pallini
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const c1 = { x: a.x + dx * 0.3 + nx * bend * 1.3, y: a.y + dy * 0.3 + ny * bend * 1.3 };
        const c2 = { x: a.x + dx * 0.7 + nx * bend * 0.9, y: a.y + dy * 0.7 + ny * bend * 0.9 };
        path.setAttribute("d", `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`);

        if (visible) requestAnimationFrame(drawThread);
    }

    new IntersectionObserver(([entry]) => {
        const was = visible;
        visible = entry.isIntersecting;
        if (visible && !was) requestAnimationFrame(drawThread);
    }).observe(sheetsBox);
    requestAnimationFrame(drawThread);
}

/* =========================================================
   12. SCORRIMENTO MORBIDO VERSO LE SEZIONI
   Accelera piano, rallenta dolcemente all'arrivo; la durata cresce
   con la distanza. Se l'utente scorre da solo, ci si ferma subito.
   ========================================================= */
(function () {
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    let anim = 0;
    const stop = () => cancelAnimationFrame(anim);
    ["wheel", "touchstart", "keydown"].forEach((ev) => window.addEventListener(ev, stop, { passive: true }));

    function scrollToY(y) {
        stop();
        const start = window.scrollY;
        const dist = y - start;
        const duration = Math.min(1400, Math.max(700, Math.abs(dist) * 0.35));
        const t0 = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - t0) / duration);
            window.scrollTo(0, start + dist * easeInOut(t));
            if (t < 1) anim = requestAnimationFrame(step);
        };
        anim = requestAnimationFrame(step);
    }

    window.smoothScrollTo = (y) => (reduceMotion ? window.scrollTo(0, y) : scrollToY(y));

    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", (e) => {
            const id = link.getAttribute("href");
            const target = id === "#" ? document.body : document.querySelector(id);
            if (!target) return;
            e.preventDefault();
            const y = Math.min(
                target.getBoundingClientRect().top + window.scrollY,
                document.documentElement.scrollHeight - window.innerHeight
            );
            if (reduceMotion) window.scrollTo(0, y);
            else scrollToY(y);
            history.pushState(null, "", id);
        });
    });
})();
