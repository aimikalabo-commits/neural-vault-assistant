/*
 * Neural Vault Assistant — Obsidian Plugin
 * v3 — Synaptic Brain Graph + Voice
 */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var main_exports = {};
__export(main_exports, { default: () => NeuralVaultPlugin });
module.exports = __toCommonJS(main_exports);
var obsidian = require("obsidian");

// ── API Client ────────────────────────────────────────────────────────────────
class ApiClient {
  constructor(baseUrl) { this.baseUrl = baseUrl.replace(/\/$/, ""); }
  async health() {
    try { return (await fetch(`${this.baseUrl}/health`)).ok; } catch { return false; }
  }
  async chat(message, nContext = 5) {
    const res = await fetch(`${this.baseUrl}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, n_context: nContext }),
    });
    if (!res.ok) throw new Error(`Backend error ${res.status}: ${await res.text()}`);
    return res.json();
  }
  async chatWithImage(message, imageBase64, mediaType, nContext = 5) {
    const res = await fetch(`${this.baseUrl}/chat/image`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, image_base64: imageBase64, media_type: mediaType, n_context: nContext }),
    });
    if (!res.ok) throw new Error(`Backend error ${res.status}: ${await res.text()}`);
    return res.json();
  }
  async reindex() {
    const res = await fetch(`${this.baseUrl}/reindex`, { method: "POST" });
    if (!res.ok) throw new Error("Reindex failed.");
    return res.json();
  }
  async clearHistory() { await fetch(`${this.baseUrl}/chat/history`, { method: "DELETE" }); }
  async graph() {
    const res = await fetch(`${this.baseUrl}/graph`);
    if (!res.ok) throw new Error("Failed to fetch graph.");
    return res.json();
  }
}

// ── Synaptic Burst Particles ──────────────────────────────────────────────────
class SynapticBurst {
  constructor(x, y, color) {
    this.x = x; this.y = y; this.color = color;
    this.born = performance.now();
    this.life = 600;
    this.particles = Array.from({ length: 7 }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: 20 + Math.random() * 28,
      r: 1.2 + Math.random() * 1.5,
    }));
  }
  draw(ctx, now) {
    const age = now - this.born;
    if (age >= this.life) return false;
    const prog = age / this.life;
    const alpha = (1 - prog * prog) * 0.8;
    for (const p of this.particles) {
      const dist = p.speed * (age / 1000);
      ctx.beginPath();
      ctx.arc(
        this.x + Math.cos(p.angle) * dist,
        this.y + Math.sin(p.angle) * dist,
        p.r * (1 - prog * 0.5), 0, Math.PI * 2
      );
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return true;
  }
}

// ── Neural Graph Engine ───────────────────────────────────────────────────────
const NEURAL_PALETTE = [
  '#00c8ff', '#48e0ff', '#00ff99', '#44aaff',
  '#a855f7', '#e040fb', '#00e5ff', '#69f0ae',
  '#536dfe', '#40c4ff', '#b388ff', '#84ffff',
];

class NeuralGraph {
  constructor(canvas, onNodeClick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNodeClick = onNodeClick;
    this.nodes = [];
    this.edges = [];
    this.nodeMap = {};
    this._adj = {};
    this.signals = [];
    this.bursts = [];
    this.fireTimes = {};
    this.transform = { x: 0, y: 0, scale: 1 };
    this.hoveredNode = null;
    this.draggedNode = null;
    this.isPanning = false;
    this.didDrag = false;
    this.alpha = 0;
    this.highlightedNodes = new Set();
    this._raf = null;
    this._lastT = 0;
    this._bgCache = null; // offscreen canvas for background blobs
    this._bgW = 0; this._bgH = 0;
    this._setupEvents();
  }

  load(nodes, edges) {
    const w = this.canvas.width || 600, h = this.canvas.height || 400;
    this.nodes = nodes.map((n, i) => ({
      ...n,
      x: w / 2 + (Math.random() - 0.5) * w * 0.5,
      y: h / 2 + (Math.random() - 0.5) * h * 0.5,
      vx: 0, vy: 0,
      r: Math.max(5, Math.min(18, 5 + (n.connections || 0) * 2.2)),
      color: this._color(n, i),
      spikeOffset: Math.random() * Math.PI * 2,
      fixed: false,
    }));
    this.edges = edges.map(e => ({ ...e, cp: null, nextSpawn: 0, hlNextSpawn: 0 }));
    this.nodeMap = {};
    for (const n of this.nodes) this.nodeMap[n.id] = n;
    this._adj = {};
    for (const e of this.edges) {
      (this._adj[e.source] = this._adj[e.source] || []).push(e);
      (this._adj[e.target] = this._adj[e.target] || []).push(e);
    }
    this._computeCPs();
    this.alpha = 1;
    this.signals = [];
    this.bursts = [];
    this._start();
  }

  _color(node, i) {
    if (node.tags?.length) {
      let h = 0;
      for (const c of String(node.tags[0])) h = ((h * 31) + c.charCodeAt(0)) >>> 0;
      return NEURAL_PALETTE[h % NEURAL_PALETTE.length];
    }
    return NEURAL_PALETTE[i % NEURAL_PALETTE.length];
  }

  _computeCPs() {
    for (const e of this.edges) e.cp = this._getCP(e.source, e.target);
  }

  _getCP(aId, bId) {
    const a = this.nodeMap[aId], b = this.nodeMap[bId];
    if (!a || !b) return { x: 0, y: 0 };
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    let hash = 0;
    for (const c of (aId + bId)) hash = ((hash * 31) + c.charCodeAt(0)) >>> 0;
    const sign = hash % 2 === 0 ? 1 : -1;
    const curve = Math.min(dist * 0.38, 90);
    return {
      x: mx + (-dy / dist) * curve * sign,
      y: my + (dx / dist) * curve * sign,
    };
  }

  _bezierAt(ax, ay, cpx, cpy, bx, by, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * ax + 2 * mt * t * cpx + t * t * bx,
      y: mt * mt * ay + 2 * mt * t * cpy + t * t * by,
    };
  }

  _start() {
    if (this._raf) return;
    this._lastT = performance.now();
    this._lastFrame = 0;
    const FRAME_MS = 1000 / 30; // cap at 30fps
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      if (now - this._lastFrame < FRAME_MS) return;
      this._lastFrame = now;
      const dt = Math.min((now - this._lastT) / 1000, 0.06);
      this._lastT = now;
      this._tick(dt);
      this._spawnSignals(now);
      this._draw(now);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  _tick(dt) {
    const n = this.nodes.length;
    if (!n) return;
    const w = this.canvas.width, h = this.canvas.height;

    if (this.alpha > 0) {
      const k = Math.sqrt((w * h) / n) * 0.85;

      // Repulsion
      for (let i = 0; i < n; i++) {
        const a = this.nodes[i];
        for (let j = i + 1; j < n; j++) {
          const b = this.nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = Math.min((k * k) / d, 40) * this.alpha;
          dx /= d; dy /= d;
          a.vx -= dx * f; a.vy -= dy * f;
          b.vx += dx * f; b.vy += dy * f;
        }
      }

      // Springs
      for (const e of this.edges) {
        const a = this.nodeMap[e.source], b = this.nodeMap[e.target];
        if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d / k) * 0.5 * this.alpha;
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f;
        b.vx -= dx * f; b.vy -= dy * f;
      }

      // Center gravity + integrate
      const cx = w / 2, cy = h / 2;
      for (const nd of this.nodes) {
        if (nd.fixed) { nd.vx = 0; nd.vy = 0; continue; }
        nd.vx += (cx - nd.x) * 0.022 * this.alpha;
        nd.vy += (cy - nd.y) * 0.022 * this.alpha;
        nd.vx *= 0.62; nd.vy *= 0.62;
        nd.x = Math.max(40, Math.min(w - 40, nd.x + nd.vx));
        nd.y = Math.max(40, Math.min(h - 40, nd.y + nd.vy));
      }

      this.alpha = Math.max(0, this.alpha - 0.007);
      this._computeCPs();
    }

    // Advance signals
    const dead = [];
    for (let i = 0; i < this.signals.length; i++) {
      const s = this.signals[i];
      s.t += s.speed * dt;
      if (s.t >= 1) {
        dead.push(i);
        // Fire the destination node
        const tgt = this.nodeMap[s.target];
        if (tgt) {
          this.fireTimes[s.target] = performance.now();
          this.bursts.push(new SynapticBurst(tgt.x, tgt.y, s.color));
          // Cascade: spawn signals from the fired node
          if (Math.random() < 0.35 && this.signals.length < 18) {
            const out = this._adj[s.target] || [];
            for (const e of out) {
              if (this.signals.length >= 18) break;
              const nextId = e.source === s.target ? e.target : e.source;
              if (nextId !== s.source && Math.random() < 0.4) {
                this.signals.push({
                  source: s.target, target: nextId, edge: e,
                  t: 0, speed: 0.3 + Math.random() * 0.3,
                  color: tgt.color,
                });
              }
            }
          }
        }
      }
    }
    for (let i = dead.length - 1; i >= 0; i--) this.signals.splice(dead[i], 1);
  }

  _spawnSignals(now) {
    if (!this.edges.length || this.signals.length >= 18) return;

    // Background spontaneous activity
    for (const e of this.edges) {
      if (this.signals.length >= 18) break;
      if (now >= e.nextSpawn) {
        const fwd = Math.random() < 0.5;
        const src = fwd ? e.source : e.target;
        const tgt = fwd ? e.target : e.source;
        this.signals.push({
          source: src, target: tgt, edge: e,
          t: 0, speed: 0.25 + Math.random() * 0.28,
          color: this.nodeMap[src]?.color || '#00c8ff',
        });
        e.nextSpawn = now + 1500 + Math.random() * 5000;
      }
    }

    // Highlighted nodes fire more often
    for (const nodeId of this.highlightedNodes) {
      if (this.signals.length >= 18) break;
      const connEdges = this._adj[nodeId] || [];
      for (const e of connEdges) {
        if (this.signals.length >= 18) break;
        if (now >= e.hlNextSpawn) {
          const tgt = e.source === nodeId ? e.target : e.source;
          this.signals.push({
            source: nodeId, target: tgt, edge: e,
            t: 0, speed: 0.55 + Math.random() * 0.4,
            color: this.nodeMap[nodeId]?.color || '#00ff99',
          });
          e.hlNextSpawn = now + 300 + Math.random() * 600;
        }
      }
    }
  }

  _draw(now) {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    if (!w || !h) return;
    const t = this.transform;

    // ── Background ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#07050f';
    ctx.fillRect(0, 0, w, h);

    // Brain tissue texture — rendered once to offscreen canvas, reused each frame
    if (!this._bgCache || this._bgW !== w || this._bgH !== h) {
      this._bgW = w; this._bgH = h;
      this._bgCache = new OffscreenCanvas(w, h);
      const bc = this._bgCache.getContext('2d');
      const blobs = [
        { x: .18, y: .28, rx: .30, ry: .22, c: '#1a0a2e' },
        { x: .72, y: .62, rx: .28, ry: .32, c: '#0e1428' },
        { x: .50, y: .15, rx: .22, ry: .18, c: '#12082a' },
        { x: .15, y: .72, rx: .20, ry: .18, c: '#0a1420' },
        { x: .82, y: .22, rx: .18, ry: .22, c: '#1a0820' },
        { x: .50, y: .80, rx: .35, ry: .18, c: '#0c1020' },
      ];
      for (const b of blobs) {
        bc.save();
        bc.translate(b.x * w, b.y * h);
        bc.scale(b.rx * w / 100, b.ry * h / 100);
        const g = bc.createRadialGradient(0, 0, 0, 0, 0, 100);
        g.addColorStop(0, b.c);
        g.addColorStop(1, 'transparent');
        bc.fillStyle = g;
        bc.beginPath();
        bc.arc(0, 0, 100, 0, Math.PI * 2);
        bc.fill();
        bc.restore();
      }
    }
    ctx.drawImage(this._bgCache, 0, 0);

    // ── Graph layer ─────────────────────────────────────────────────────────
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);

    // Axons (curved edges)
    for (const e of this.edges) {
      const a = this.nodeMap[e.source], b = this.nodeMap[e.target];
      if (!a || !b || !e.cp) continue;
      const hl = this.hoveredNode && (this.hoveredNode.id === e.source || this.hoveredNode.id === e.target);
      const active = this.highlightedNodes.has(e.source) || this.highlightedNodes.has(e.target);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(e.cp.x, e.cp.y, b.x, b.y);
      ctx.strokeStyle = hl ? a.color + 'bb' : active ? a.color + '44' : '#ffffff10';
      ctx.lineWidth = (hl ? 1.8 : 0.8) / t.scale;
      ctx.stroke();
    }

    // Traveling signals (action potentials) — no shadowBlur, use alpha for glow illusion
    for (const sig of this.signals) {
      const a = this.nodeMap[sig.source], b = this.nodeMap[sig.target];
      if (!a || !b || !sig.edge?.cp) continue;
      const cp = sig.edge.cp;

      // Trail (5 steps, cheap)
      for (let i = 5; i >= 0; i--) {
        const trailT = Math.max(0, sig.t - (i / 5) * 0.10);
        const p = this._bezierAt(a.x, a.y, cp.x, cp.y, b.x, b.y, trailT);
        ctx.beginPath();
        ctx.arc(p.x, p.y, ((5 - i) / 5) * 3, 0, Math.PI * 2);
        ctx.globalAlpha = ((5 - i) / 5) * 0.75;
        ctx.fillStyle = sig.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Signal head — bright white dot
      const hp = this._bezierAt(a.x, a.y, cp.x, cp.y, b.x, b.y, sig.t);
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    // Neuron somas (nodes)
    for (const nd of this.nodes) {
      const isHov = this.hoveredNode?.id === nd.id;
      const isSrc = this.highlightedNodes.has(nd.id);
      const fireAge = performance.now() - (this.fireTimes[nd.id] || 0);
      const justFired = fireAge < 600;
      const fireGlow = justFired ? Math.max(0, 1 - fireAge / 600) : 0;
      const r = nd.r * (isHov ? 1.55 : 1);

      // Dendrite spikes (no shadowBlur — too expensive per spike)
      const numSpikes = Math.max(4, Math.min(10, 4 + (nd.connections || 0) * 2));
      ctx.strokeStyle = nd.color + (isHov ? '66' : '33');
      ctx.lineWidth = 0.8 / t.scale;
      for (let i = 0; i < numSpikes; i++) {
        const angle = nd.spikeOffset + (i / numSpikes) * Math.PI * 2;
        const len = r + 5 + Math.sin(now / 700 + i * 2.3) * 2.5;
        ctx.beginPath();
        ctx.moveTo(nd.x + Math.cos(angle) * (r * 0.85), nd.y + Math.sin(angle) * (r * 0.85));
        ctx.lineTo(nd.x + Math.cos(angle) * len, nd.y + Math.sin(angle) * len);
        ctx.stroke();
      }

      // Soma glow — single shadowBlur set per node
      ctx.shadowBlur = isHov ? 40 : isSrc ? 28 : justFired ? 35 : 14;
      ctx.shadowColor = justFired ? '#ffffff' : nd.color;

      // Soma body — gradient pre-rendered to offscreen canvas, rebuilt only when r or hover changes
      const gradKey = `${r}|${isHov}`;
      if (!nd._gradKey || nd._gradKey !== gradKey) {
        nd._gradKey = gradKey;
        const sz = Math.ceil(r * 2 + 2);
        const og = new OffscreenCanvas(sz, sz);
        const oc = og.getContext('2d');
        const cx = sz / 2, cy = sz / 2;
        const g = oc.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
        g.addColorStop(0, nd.color + (isHov ? 'ff' : 'cc'));
        g.addColorStop(0.6, nd.color + (isHov ? 'dd' : 'aa'));
        g.addColorStop(1, nd.color + '44');
        oc.fillStyle = g;
        oc.beginPath();
        oc.arc(cx, cy, r, 0, Math.PI * 2);
        oc.fill();
        nd._gradImg = og;
      }
      ctx.drawImage(nd._gradImg, nd.x - nd._gradImg.width / 2, nd.y - nd._gradImg.height / 2);

      // Bright nucleus
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(nd.x - r * 0.25, nd.y - r * 0.25, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${isHov ? 0.5 : 0.2 + fireGlow * 0.4})`;
      ctx.fill();

      // Fire ring
      if (justFired) {
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, r + (1 - fireGlow) * 18, 0, Math.PI * 2);
        ctx.strokeStyle = nd.color + Math.floor(fireGlow * 160).toString(16).padStart(2, '0');
        ctx.lineWidth = 2 / t.scale;
        ctx.shadowBlur = 20;
        ctx.shadowColor = nd.color;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Hover ring
      if (isHov) {
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = nd.color + '66';
        ctx.lineWidth = 1.5 / t.scale;
        ctx.stroke();
      }

      // Source pulse ring
      if (isSrc && !justFired) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 400);
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, r + 4 + pulse * 5, 0, Math.PI * 2);
        ctx.strokeStyle = nd.color + '44';
        ctx.lineWidth = 1.2 / t.scale;
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;

    // Labels
    for (const nd of this.nodes) {
      const isHov = this.hoveredNode?.id === nd.id;
      const isSrc = this.highlightedNodes.has(nd.id);
      if (!isHov && !isSrc && (nd.connections || 0) < 2) continue;
      const r = nd.r * (isHov ? 1.55 : 1);
      const fs = Math.max(8, Math.min(13, 10 / t.scale));
      ctx.font = `${isHov ? 'bold ' : ''}${fs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#000000dd';
      ctx.fillStyle = isHov ? '#ffffff' : isSrc ? '#d0f0ff' : '#8899bb';
      ctx.fillText(nd.title, nd.x, nd.y + r + fs + 3);
      ctx.shadowBlur = 0;
    }

    ctx.restore();

    // Synaptic burst particles (screen-space, no transform — converted)
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);
    this.bursts = this.bursts.filter(b => b.draw(ctx, now));
    ctx.restore();

    // Tooltip (always screen-space)
    if (this.hoveredNode) {
      const nd = this.hoveredNode;
      const sx = nd.x * t.scale + t.x;
      const sy = nd.y * t.scale + t.y;
      const tagStr = nd.tags?.length ? `  #${nd.tags.join(' #')}` : '';
      const connStr = `  ${nd.connections || 0} link${nd.connections !== 1 ? 's' : ''}`;

      ctx.font = 'bold 12px sans-serif';
      const tw = ctx.measureText(nd.title).width;
      ctx.font = '11px sans-serif';
      const sw = ctx.measureText(tagStr + connStr).width;
      const bw = Math.max(tw, sw) + 20, bh = 42;
      const bx = Math.min(sx + 16, w - bw - 6);
      const by = Math.max(sy - 55, 4);

      ctx.fillStyle = '#0d0c22ee';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 7);
      ctx.fill();

      ctx.fillStyle = '#d0e8ff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.shadowBlur = 0;
      ctx.fillText(nd.title, bx + 10, by + 17);
      ctx.fillStyle = '#5566aa';
      ctx.font = '11px sans-serif';
      ctx.fillText(tagStr + connStr, bx + 10, by + 31);
    }
  }

  highlightSources(titleSet) {
    this.highlightedNodes = titleSet instanceof Set ? titleSet : new Set(titleSet);
  }

  fitToScreen() {
    if (!this.nodes.length) return;
    const w = this.canvas.width, h = this.canvas.height;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const nd of this.nodes) {
      minX = Math.min(minX, nd.x); maxX = Math.max(maxX, nd.x);
      minY = Math.min(minY, nd.y); maxY = Math.max(maxY, nd.y);
    }
    const scale = Math.min((w - 100) / ((maxX - minX) || 1), (h - 100) / ((maxY - minY) || 1), 4);
    this.transform.scale = scale;
    this.transform.x = (w - (minX + maxX) * scale) / 2;
    this.transform.y = (h - (minY + maxY) * scale) / 2;
  }

  reheat() { this.alpha = Math.max(this.alpha, 0.4); }

  _setupEvents() {
    const c = this.canvas;
    let lastPX = 0, lastPY = 0;

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = e.deltaY > 0 ? 0.88 : 1.14;
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      this.transform.x = mx - (mx - this.transform.x) * d;
      this.transform.y = my - (my - this.transform.y) * d;
      this.transform.scale = Math.max(0.1, Math.min(8, this.transform.scale * d));
    }, { passive: false });

    c.addEventListener('mousedown', (e) => {
      const gp = this._toGraph(e);
      const hit = this._hitTest(gp.x, gp.y);
      if (hit) { this.draggedNode = hit; hit.fixed = true; }
      else { this.isPanning = true; lastPX = e.clientX; lastPY = e.clientY; }
      this.didDrag = false;
      e.preventDefault();
    });

    c.addEventListener('mousemove', (e) => {
      if (this.draggedNode) {
        this.didDrag = true;
        const gp = this._toGraph(e);
        this.draggedNode.x = gp.x;
        this.draggedNode.y = gp.y;
        this.draggedNode.vx = 0; this.draggedNode.vy = 0;
        this.reheat();
        c.style.cursor = 'grabbing';
      } else if (this.isPanning) {
        this.didDrag = true;
        this.transform.x += e.clientX - lastPX;
        this.transform.y += e.clientY - lastPY;
        lastPX = e.clientX; lastPY = e.clientY;
        c.style.cursor = 'grabbing';
      } else {
        const gp = this._toGraph(e);
        this.hoveredNode = this._hitTest(gp.x, gp.y);
        c.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
      }
    });

    c.addEventListener('mouseup', () => {
      if (this.draggedNode) { this.draggedNode.fixed = false; this.draggedNode = null; }
      this.isPanning = false;
      c.style.cursor = 'grab';
    });

    c.addEventListener('mouseleave', () => {
      if (this.draggedNode) { this.draggedNode.fixed = false; this.draggedNode = null; }
      this.isPanning = false;
      this.hoveredNode = null;
    });

    c.addEventListener('click', (e) => {
      if (this.didDrag) { this.didDrag = false; return; }
      const gp = this._toGraph(e);
      const node = this._hitTest(gp.x, gp.y);
      if (node && this.onNodeClick) this.onNodeClick(node);
    });

    c.addEventListener('dblclick', (e) => {
      const gp = this._toGraph(e);
      if (!this._hitTest(gp.x, gp.y)) this.fitToScreen();
    });
  }

  _toGraph(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - this.transform.x) / this.transform.scale,
      y: (e.clientY - r.top - this.transform.y) / this.transform.scale,
    };
  }

  _hitTest(x, y) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const nd = this.nodes[i];
      const dx = nd.x - x, dy = nd.y - y;
      if (dx * dx + dy * dy <= (nd.r + 8) * (nd.r + 8)) return nd;
    }
    return null;
  }
}

// ── Graph View ────────────────────────────────────────────────────────────────
const GRAPH_VIEW_TYPE = 'neural-vault-graph';

class GraphView extends obsidian.ItemView {
  constructor(leaf, client, plugin) {
    super(leaf);
    this.client = client;
    this.plugin = plugin;
    this.neural = null;
    this._ro = null;
  }
  getViewType() { return GRAPH_VIEW_TYPE; }
  getDisplayText() { return 'Neural Graph'; }
  getIcon() { return 'sparkles'; }

  async onOpen() {
    this.buildUI();
    await this.loadGraph();

    // Reload graph when vault files change (debounced)
    const reload = this._debounce(() => this.loadGraph(), 1500);
    this.registerEvent(this.app.vault.on('create', f => { if (f.extension === 'md') reload(); }));
    this.registerEvent(this.app.vault.on('delete', f => { if (f.path?.endsWith('.md')) reload(); }));
    this.registerEvent(this.app.vault.on('rename', f => { if (f.extension === 'md') reload(); }));
  }

  onClose() {
    if (this.neural) { this.neural.stop(); this.neural = null; }
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
  }

  _debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  buildUI() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass('nvg-root');
    this.applyStyles();

    const header = root.createDiv({ cls: 'nvg-header' });
    const title = header.createDiv({ cls: 'nvg-title' });
    obsidian.setIcon(title.createSpan(), 'brain-circuit');
    title.createSpan({ text: ' Neural Graph' });

    const right = header.createDiv({ cls: 'nvg-actions' });
    this.statsEl = right.createSpan({ cls: 'nvg-stats', text: 'Loading…' });

    const fitBtn = right.createEl('button', { cls: 'nvg-btn', attr: { title: 'Fit to screen (or dbl-click bg)' } });
    obsidian.setIcon(fitBtn, 'maximize-2');
    fitBtn.addEventListener('click', () => this.neural?.fitToScreen());

    const refreshBtn = right.createEl('button', { cls: 'nvg-btn', attr: { title: 'Refresh' } });
    obsidian.setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => this.loadGraph());

    this.canvas = root.createEl('canvas', { cls: 'nvg-canvas' });

    this._ro = new ResizeObserver(() => {
      const w = this.canvas.offsetWidth, h = this.canvas.offsetHeight;
      if (w > 0 && h > 0) { this.canvas.width = w; this.canvas.height = h; if (this.neural) this.neural.reheat(); }
    });
    this._ro.observe(this.canvas);
  }

  async loadGraph() {
    if (this.statsEl) this.statsEl.setText('Loading…');
    try {
      const data = await this.client.graph();
      this.canvas.width = this.canvas.offsetWidth || 600;
      this.canvas.height = this.canvas.offsetHeight || 400;
      if (this.neural) this.neural.stop();
      this.neural = new NeuralGraph(this.canvas, node => {
        this.app.workspace.openLinkText(node.title, '', false);
      });
      this.neural.load(data.nodes, data.edges);
      if (this.plugin.lastSources?.size) this.neural.highlightSources(this.plugin.lastSources);
      if (this.statsEl) this.statsEl.setText(`${data.nodes.length} neurons · ${data.edges.length} synapses`);
    } catch {
      if (this.statsEl) this.statsEl.setText('Failed — is backend running?');
    }
  }

  applyStyles() {
    if (document.getElementById('nvg-styles')) return;
    const s = document.createElement('style');
    s.id = 'nvg-styles';
    s.textContent = `
      .nvg-root { display:flex; flex-direction:column; height:100%; background:#07050f; overflow:hidden; }
      .nvg-header { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#0b0918; border-bottom:1px solid #ffffff10; flex-shrink:0; }
      .nvg-title { display:flex; align-items:center; gap:6px; font-weight:600; font-size:14px; color:#48e0ff; }
      .nvg-actions { display:flex; align-items:center; gap:8px; }
      .nvg-stats { font-size:11px; color:#335566; margin-right:4px; }
      .nvg-btn { background:none; border:1px solid #ffffff15; cursor:pointer; color:#336688; padding:3px 7px; border-radius:5px; display:flex; align-items:center; transition:all .15s; }
      .nvg-btn:hover { color:#48e0ff; border-color:#48e0ff44; background:#48e0ff10; }
      .nvg-canvas { flex:1; width:100%; display:block; cursor:grab; min-height:0; }
    `;
    document.head.appendChild(s);
  }
}

// ── Chat View ─────────────────────────────────────────────────────────────────
const CHAT_VIEW_TYPE = "neural-vault-chat";

class ChatView extends obsidian.ItemView {
  constructor(leaf, client, plugin) {
    super(leaf);
    this.client = client;
    this.plugin = plugin;
    this.voiceEnabled = false;
    this.pendingImage = null;
  }
  getViewType() { return CHAT_VIEW_TYPE; }
  getDisplayText() { return "Neural Vault"; }
  getIcon() { return "brain-circuit"; }

  async onOpen() { this.buildUI(); await this.checkBackendStatus(); }
  async onClose() { if (this.voiceEnabled && window.speechSynthesis) window.speechSynthesis.cancel(); }

  buildUI() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("nva-root");
    this.pendingImage = null;

    const header = root.createDiv({ cls: "nva-header" });
    const titleEl = header.createDiv({ cls: "nva-title" });
    obsidian.setIcon(titleEl.createSpan({ cls: "nva-icon" }), "brain-circuit");
    titleEl.createSpan({ text: " Neural Vault" });

    const ha = header.createDiv({ cls: "nva-header-actions" });

    const graphBtn = ha.createEl("button", { cls: "nva-btn-icon", attr: { title: "Open Neural Graph" } });
    obsidian.setIcon(graphBtn, "sparkles");
    graphBtn.addEventListener("click", () => this.plugin.activateGraphView());

    this.voiceBtn = ha.createEl("button", { cls: "nva-btn-icon", attr: { title: "Toggle voice" } });
    obsidian.setIcon(this.voiceBtn, "volume-x");
    this.voiceBtn.addEventListener("click", () => this.toggleVoice());

    const reindexBtn = ha.createEl("button", { cls: "nva-btn-icon", attr: { title: "Re-index vault" } });
    obsidian.setIcon(reindexBtn, "refresh-cw");
    reindexBtn.addEventListener("click", () => this.handleReindex());

    const clearBtn = ha.createEl("button", { cls: "nva-btn-icon", attr: { title: "Clear conversation" } });
    obsidian.setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => this.handleClear());

    this.statusEl = root.createDiv({ cls: "nva-status" });
    this.messagesEl = root.createDiv({ cls: "nva-messages" });
    this.addSystemMessage("Hello! I'm your Neural Vault assistant. Ask me anything about your notes, paste an image, or tell me to create a note.");

    this.imagePreviewEl = root.createDiv({ cls: "nva-image-preview nva-hidden" });
    const pi = this.imagePreviewEl.createDiv({ cls: "nva-image-preview-inner" });
    this.previewImg = pi.createEl("img", { cls: "nva-preview-img" });
    const rb = pi.createEl("button", { cls: "nva-remove-image", attr: { title: "Remove image" } });
    obsidian.setIcon(rb, "x");
    rb.addEventListener("click", () => this.clearPendingImage());

    const ia = root.createDiv({ cls: "nva-input-area" });
    this.inputEl = ia.createEl("textarea", {
      cls: "nva-input",
      attr: { placeholder: "Ask about your notes, paste an image (Ctrl+V), or drag & drop…", rows: "3" },
    });
    this.inputEl.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.handleSend(); } });
    this.inputEl.addEventListener("paste", e => this.handlePaste(e));
    this.inputEl.addEventListener("dragover", e => { e.preventDefault(); this.inputEl.addClass("nva-drag-over"); });
    this.inputEl.addEventListener("dragleave", () => this.inputEl.removeClass("nva-drag-over"));
    this.inputEl.addEventListener("drop", e => { e.preventDefault(); this.inputEl.removeClass("nva-drag-over"); this.handleDrop(e); });

    this.micBtn = ia.createEl("button", { cls: "nva-btn-icon nva-mic-btn", attr: { title: "Μιλήστε ελληνικά (Speak Greek)" } });
    obsidian.setIcon(this.micBtn, "mic");
    this.micBtn.addEventListener("click", () => this.toggleListening());

    this.sendBtn = ia.createEl("button", { cls: "nva-send-btn", text: "Send" });
    this.sendBtn.addEventListener("click", () => this.handleSend());

    this.applyStyles(root);
  }

  async checkBackendStatus() {
    const alive = await this.client.health();
    this.setStatus(alive ? "Connected" : "Backend offline — start the Python server on port 8765", alive ? "var(--color-green)" : "var(--color-red)");
  }

  async handleSend() {
    if (this._recognition) { this._recognition.stop(); }
    const text = this.inputEl.value.trim();
    if (!text && !this.pendingImage) return;
    this.inputEl.value = "";
    this.setSending(true);
    try {
      let response;
      if (this.pendingImage) {
        this.addMessage({ role: "user", content: text || "What is in this image?", imageDataUrl: this.pendingImage.dataUrl });
        response = await this.client.chatWithImage(text || "What is in this image?", this.pendingImage.base64, this.pendingImage.mediaType);
        this.clearPendingImage();
      } else {
        this.addMessage({ role: "user", content: text });
        response = await this.client.chat(text);
      }
      this.addMessage({ role: "assistant", content: response.reply, sources: response.sources, actionResult: response.action_result });
      this.speak(response.reply);
      this.plugin.setLastSources(new Set((response.sources || []).map(s => s.title)));
    } catch (err) {
      this.addMessage({ role: "system", content: `Error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      this.setSending(false);
    }
  }

  toggleVoice() {
    this.voiceEnabled = !this.voiceEnabled;
    obsidian.setIcon(this.voiceBtn, this.voiceEnabled ? 'volume-2' : 'volume-x');
    this.voiceBtn.toggleClass('nva-voice-active', this.voiceEnabled);
    if (!this.voiceEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
  }

  speak(text) {
    if (!this.voiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const plain = text.replace(/```[\s\S]*?```/g, 'μπλοκ κώδικα.').replace(/[*_`#>\[\]]/g, '').replace(/<[^>]+>/g, '').trim();
    const utt = new SpeechSynthesisUtterance(plain);
    utt.lang = 'el-GR';
    utt.rate = 0.92;
    utt.pitch = 1.05;
    const trySpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      // Prefer a Greek voice (macOS: Melina, Google: el-GR)
      const greek = voices.find(v => v.lang === 'el-GR' || v.lang === 'el_GR' || /Melina|Νέα Ελληνικά/.test(v.name));
      if (greek) utt.voice = greek;
      window.speechSynthesis.speak(utt);
    };
    window.speechSynthesis.getVoices().length ? trySpeak() : (window.speechSynthesis.onvoiceschanged = trySpeak);
  }

  toggleListening() {
    if (this._recognition) {
      this._recognition.stop();
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      new obsidian.Notice('Η αναγνώριση φωνής δεν υποστηρίζεται σε αυτό το πρόγραμμα περιήγησης.');
      return;
    }
    const rec = new SR();
    rec.lang = 'el-GR';
    rec.continuous = false;
    rec.interimResults = true;

    rec.onstart = () => {
      this.micBtn.addClass('nva-mic-active');
      obsidian.setIcon(this.micBtn, 'mic');
    };

    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      this.inputEl.value = transcript;
      // If final result, auto-send
      if (e.results[e.results.length - 1].isFinal) {
        setTimeout(() => this.handleSend(), 300);
      }
    };

    rec.onerror = (e) => {
      console.error('[NeuralVault] Speech error:', e.error);
      this._recognition = null;
      this.micBtn.removeClass('nva-mic-active');
      obsidian.setIcon(this.micBtn, 'mic');
    };

    rec.onend = () => {
      this._recognition = null;
      this.micBtn.removeClass('nva-mic-active');
      obsidian.setIcon(this.micBtn, 'mic');
    };

    this._recognition = rec;
    rec.start();
  }

  handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) { e.preventDefault(); this.loadImageFile(item.getAsFile(), item.type); return; }
    }
  }

  handleDrop(e) {
    const file = e.dataTransfer?.files?.[0];
    if (file?.type.startsWith("image/")) this.loadImageFile(file, file.type);
  }

  loadImageFile(file, mediaType) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      this.pendingImage = { base64: dataUrl.split(",")[1], mediaType, dataUrl };
      this.previewImg.src = dataUrl;
      this.imagePreviewEl.removeClass("nva-hidden");
      this.inputEl.setAttribute("placeholder", "Add a message about this image (optional)…");
    };
    reader.readAsDataURL(file);
  }

  clearPendingImage() {
    this.pendingImage = null; this.previewImg.src = "";
    this.imagePreviewEl.addClass("nva-hidden");
    this.inputEl.setAttribute("placeholder", "Ask about your notes, paste an image (Ctrl+V), or drag & drop…");
  }

  async handleReindex() {
    this.setStatus("Re-indexing…", "orange");
    try {
      const r = await this.client.reindex();
      this.setStatus(`Indexed ${r.note_count} chunks`, "var(--color-green)");
      this.addSystemMessage(`Vault re-indexed — ${r.note_count} chunks in store.`);
    } catch { this.setStatus("Reindex failed", "var(--color-red)"); }
  }

  async handleClear() {
    await this.client.clearHistory();
    this.messagesEl.empty();
    this.addSystemMessage("Conversation cleared.");
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  addMessage(msg) {
    const el = this.messagesEl.createDiv({ cls: `nva-msg nva-msg-${msg.role}` });
    el.createDiv({ cls: "nva-msg-label" }).setText(msg.role === "user" ? "You" : msg.role === "assistant" ? "Assistant" : "System");
    if (msg.imageDataUrl) { const i = el.createEl("img", { cls: "nva-msg-image" }); i.src = msg.imageDataUrl; }
    el.createDiv({ cls: "nva-msg-content" }).innerHTML = this.simpleMarkdown(msg.content);
    if (msg.actionResult) {
      const badge = el.createDiv({ cls: `nva-action-badge nva-action-${msg.actionResult.status}` });
      badge.setText({ created: `Created: ${msg.actionResult.title}`, updated: `Updated: ${msg.actionResult.title}`, appended: `Appended: ${msg.actionResult.title}`, error: `Error: ${msg.actionResult.message}` }[msg.actionResult.status] ?? "Action taken");
    }
    if (msg.sources?.length) {
      const se = el.createDiv({ cls: "nva-sources" });
      se.createDiv({ cls: "nva-sources-label", text: "Sources:" });
      for (const src of msg.sources.slice(0, 3)) {
        const chip = se.createDiv({ cls: "nva-source-chip" });
        chip.setText(`${src.title} (${src.score})`);
        chip.addEventListener("click", () => this.app.workspace.openLinkText(src.title, "", false));
      }
    }
    this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight, behavior: "smooth" });
  }

  addSystemMessage(text) { this.addMessage({ role: "system", content: text }); }
  setStatus(text, color) { this.statusEl.setText(text); this.statusEl.style.color = color; }
  setSending(s) { this.sendBtn.disabled = s; this.sendBtn.setText(s ? "…" : "Send"); this.inputEl.disabled = s; }

  simpleMarkdown(text) {
    return text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>").replace(/^## (.+)$/gm, "<h2>$1</h2>").replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/^- (.+)$/gm, "<li>$1</li>").replace(/\n/g, "<br>");
  }

  applyStyles(root) {
    if (document.getElementById("nva-styles")) return;
    const s = document.createElement("style");
    s.id = "nva-styles";
    s.textContent = `
      .nva-root{display:flex;flex-direction:column;height:100%;font-family:var(--font-interface);font-size:14px;background:var(--background-primary)}
      .nva-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--background-modifier-border);background:var(--background-secondary)}
      .nva-title{display:flex;align-items:center;gap:6px;font-weight:600;font-size:15px;color:var(--text-accent)}
      .nva-header-actions{display:flex;gap:4px}
      .nva-btn-icon{background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;border-radius:4px;display:flex;align-items:center;transition:color .15s,background .15s}
      .nva-btn-icon:hover{color:var(--text-normal);background:var(--background-modifier-hover)}
      .nva-voice-active{color:var(--color-accent)!important}
      .nva-mic-btn{border:1px solid var(--background-modifier-border);border-radius:50%;width:32px;height:32px;justify-content:center;flex-shrink:0}
      .nva-mic-active{color:#ef4444!important;border-color:#ef4444!important;animation:nva-pulse 1s ease-in-out infinite}
      @keyframes nva-pulse{0%,100%{box-shadow:0 0 0 0 #ef444455}50%{box-shadow:0 0 0 6px #ef444400}}
      .nva-status{font-size:11px;padding:3px 12px;background:var(--background-secondary-alt);border-bottom:1px solid var(--background-modifier-border)}
      .nva-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
      .nva-msg{padding:10px 12px;border-radius:8px;max-width:100%}
      .nva-msg-user{background:var(--interactive-accent);color:var(--text-on-accent);align-self:flex-end;max-width:85%}
      .nva-msg-assistant{background:var(--background-secondary);border:1px solid var(--background-modifier-border);align-self:flex-start;max-width:95%}
      .nva-msg-system{background:var(--background-secondary-alt);color:var(--text-muted);font-style:italic;font-size:12px;align-self:center;text-align:center}
      .nva-msg-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;opacity:.7}
      .nva-msg-content{line-height:1.5}
      .nva-msg-content code{background:var(--code-background);padding:1px 4px;border-radius:3px;font-family:var(--font-monospace);font-size:12px}
      .nva-action-badge{margin-top:8px;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:500}
      .nva-action-created{background:#1a4a2e;color:#4ade80}
      .nva-action-updated{background:#1a3a4a;color:#60a5fa}
      .nva-action-appended{background:#2a3a1a;color:#a3e635}
      .nva-action-error{background:#4a1a1a;color:#f87171}
      .nva-sources{margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
      .nva-sources-label{font-size:11px;color:var(--text-muted);margin-right:4px}
      .nva-source-chip{font-size:11px;padding:2px 7px;border-radius:10px;background:var(--background-modifier-border);color:var(--text-accent);cursor:pointer}
      .nva-source-chip:hover{background:var(--interactive-accent);color:var(--text-on-accent)}
      .nva-input-area{padding:10px 12px;border-top:1px solid var(--background-modifier-border);background:var(--background-secondary);display:flex;gap:8px;align-items:flex-end}
      .nva-input{flex:1;resize:none;border-radius:6px;border:1px solid var(--background-modifier-border);padding:8px 10px;background:var(--background-primary);color:var(--text-normal);font-family:var(--font-interface);font-size:13px;line-height:1.4}
      .nva-input:focus{outline:none;border-color:var(--interactive-accent)}
      .nva-send-btn{background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-weight:500;font-size:13px;white-space:nowrap}
      .nva-send-btn:hover{opacity:.9}
      .nva-send-btn:disabled{opacity:.5;cursor:not-allowed}
      .nva-image-preview{padding:6px 12px;background:var(--background-secondary);border-top:1px solid var(--background-modifier-border)}
      .nva-image-preview-inner{position:relative;display:inline-block}
      .nva-preview-img{max-height:120px;max-width:100%;border-radius:6px;display:block}
      .nva-remove-image{position:absolute;top:-6px;right:-6px;background:var(--background-modifier-border);border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
      .nva-remove-image:hover{background:var(--color-red);color:white}
      .nva-hidden{display:none!important}
      .nva-msg-image{max-height:160px;max-width:100%;border-radius:6px;margin-bottom:6px;display:block}
      .nva-input.nva-drag-over{border-color:var(--interactive-accent);background:var(--background-secondary)}
    `;
    document.head.appendChild(s);
  }
}

// ── Settings Tab ──────────────────────────────────────────────────────────────
class NVASettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Neural Vault Assistant Settings" });
    new obsidian.Setting(containerEl).setName("Backend URL").setDesc("URL of the FastAPI backend.")
      .addText(t => t.setPlaceholder("http://localhost:8765").setValue(this.plugin.settings.backendUrl)
        .onChange(async v => { this.plugin.settings.backendUrl = v; await this.plugin.saveSettings(); }));
    new obsidian.Setting(containerEl).setName("Context chunks").setDesc("Note chunks retrieved per query (1–10).")
      .addSlider(s => s.setLimits(1, 10, 1).setValue(this.plugin.settings.nContext).setDynamicTooltip()
        .onChange(async v => { this.plugin.settings.nContext = v; await this.plugin.saveSettings(); }));
    new obsidian.Setting(containerEl).setName("Test connection").setDesc("Check if backend is reachable.")
      .addButton(btn => btn.setButtonText("Test").onClick(async () => {
        const alive = await this.plugin.client.health();
        btn.setButtonText(alive ? "Connected!" : "Failed — is the server running?");
        setTimeout(() => btn.setButtonText("Test"), 3000);
      }));
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = { backendUrl: "http://localhost:8765", nContext: 5 };

class NeuralVaultPlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.client = new ApiClient(this.settings.backendUrl);
    this.lastSources = new Set();

    this.registerView(CHAT_VIEW_TYPE, leaf => new ChatView(leaf, this.client, this));
    this.registerView(GRAPH_VIEW_TYPE, leaf => new GraphView(leaf, this.client, this));

    this.addRibbonIcon("brain-circuit", "Neural Vault Chat", () => this.activateChatView());
    this.addRibbonIcon("sparkles", "Neural Graph", () => this.activateGraphView());

    this.addCommand({ id: "open-chat", name: "Open Neural Vault Chat", callback: () => this.activateChatView() });
    this.addCommand({ id: "open-graph", name: "Open Neural Graph", callback: () => this.activateGraphView() });

    this.addSettingTab(new NVASettingTab(this.app, this));
    console.log("[NeuralVault] v3 loaded.");
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(GRAPH_VIEW_TYPE);
  }

  setLastSources(titleSet) {
    this.lastSources = titleSet;
    for (const leaf of this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE)) {
      if (leaf.view instanceof GraphView) leaf.view.neural?.highlightSources(titleSet);
    }
  }

  async activateChatView() {
    const { workspace } = this.app;
    const ex = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    let leaf = ex.length > 0 ? ex[0] : workspace.getRightLeaf(false);
    if (leaf) { await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true }); workspace.revealLeaf(leaf); }
  }

  async activateGraphView() {
    const { workspace } = this.app;
    const ex = workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    if (ex.length > 0) { workspace.revealLeaf(ex[0]); return; }
    const leaf = workspace.getLeaf('split', 'vertical');
    if (leaf) { await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true }); workspace.revealLeaf(leaf); }
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); this.client = new ApiClient(this.settings.backendUrl); }
}
