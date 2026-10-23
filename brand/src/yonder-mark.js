// Yonder mark: the single source of the logo's geometry, its static drawing and its motion.
// Checked-in brand assets share this geometry; UI builds inline this source directly.

/** Geometry of the "同望" mark on a 256 × 256 canvas. */
export const MARK = Object.freeze({
	size: 256,
	big: { cx: 116, cy: 142, r: 80 },
	/** Small body radius as a share of the big one's. */
	smallScale: 0.42,
	/** White gap around the body in front, as a share of the big radius. */
	gap: 0.085,
	/** The small body's invisible orbit around the big one. */
	orbit: { rx: 1.32, ry: 0.42, tilt: -24, keyframe: -24 },
	/** Where each face looks in the keyframe, in degrees: azimuth right, elevation up. */
	gaze: { big: { az: 30, el: 18 }, small: { az: 34, el: 24 } },
	eyes: {
		big: { spread: 19, width: 0.19, height: 0.34 },
		small: { spread: 24, width: 0.22, height: 0.38 },
	},
	/** Cut for 24 px and below: no eyes on the small body, larger eyes and gap on the big one. */
	small: { gap: 0.12, gaze: { az: 24, el: 14 }, eyes: { spread: 21, width: 0.25, height: 0.42 } },
});

export const PALETTE = Object.freeze({
	ink: "#0b0b0c",
	paper: "#ffffff",
	night: "#101828",
	moon: "#f4f1e8",
});

const rad = (d) => (d * Math.PI) / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ geometry */

/** Outline of a soft round body that sits: a little wider and flatter underneath. Squash scales from the footing. */
export function bodyPoints(cx, cy, r, { sx = 1, sy = 1, foot = 0.5, n = 128 } = {}) {
	const fy = cy + r * foot;
	const pts = [];
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2;
		let x = Math.cos(t);
		let y = Math.sin(t);
		if (y > 0) {
			x *= 1 + 0.035 * y;
			y *= 1 - 0.06 * y * y;
		}
		pts.push([cx + x * r * sx, fy + (cy + y * r - fy) * sy]);
	}
	return pts;
}

/** Point on the small body's orbit at angle `th` (degrees), with its depth (`ly` > 0 is in front). */
export function orbitPoint(th, big = MARK.big) {
	const { rx, ry, tilt } = MARK.orbit;
	const lx = rx * big.r * Math.cos(rad(th));
	const ly = ry * big.r * Math.sin(rad(th));
	const a = rad(tilt);
	return { x: big.cx + lx * Math.cos(a) - ly * Math.sin(a), y: big.cy + lx * Math.sin(a) + ly * Math.cos(a), ly };
}

/**
 * Two capsule eyes painted on a sphere of radius `r`: the face is turned to (az, el), so the pair slides toward
 * where it looks and the eye nearer the rim is foreshortened. Returns one placement per visible eye.
 */
export function eyePlacements(cx, cy, r, az, el, { spread, width, height }) {
	const out = [];
	for (const off of [-spread, spread]) {
		const A = rad(az + off);
		const E = rad(el);
		const x = Math.sin(A) * Math.cos(E);
		const y = -Math.sin(E);
		const z = Math.cos(A) * Math.cos(E);
		if (z < 0.08) continue;
		out.push({ x: cx + r * x, y: cy + r * y, phi: Math.atan2(y, x), z, w: width * r, h: height * r });
	}
	return out;
}

/** Map a point from an eye's own frame onto the sphere: rotate to the rim direction, foreshorten, rotate back. */
function projectEye(e, [px, py]) {
	const c = Math.cos(e.phi);
	const s = Math.sin(e.phi);
	const u = px * c + py * s;
	const v = -px * s + py * c;
	const u2 = u * e.z;
	return [e.x + u2 * c - v * s, e.y + u2 * s + v * c];
}

/** Capsule outline (open lid `lid` 0..1) as a polygon in canvas space. */
export function capsulePoints(e, lid = 1, n = 24) {
	const w = e.w;
	const h = Math.max(e.h * lid, w * 0.32);
	const rr = Math.min(w, h) / 2;
	const half = h / 2 - rr;
	const pts = [];
	for (let i = 0; i <= n; i++)
		pts.push([rr * Math.cos(Math.PI + (Math.PI * i) / n), -half + rr * Math.sin(Math.PI + (Math.PI * i) / n)]);
	for (let i = 0; i <= n; i++) pts.push([rr * Math.cos((Math.PI * i) / n), half + rr * Math.sin((Math.PI * i) / n)]);
	return pts.map((p) => projectEye(e, p));
}

/** Path data for a closed polygon. */
export function polyPath(pts) {
	return `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;
}

/** Closed smooth path through `pts` (cubic Catmull-Rom); indices in `corners` stay sharp. */
export function smoothPath(pts, corners = new Set()) {
	const n = pts.length;
	const at = (i) => pts[(i + n) % n];
	const f = (v) => v.toFixed(2);
	let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
	for (let i = 0; i < n; i++) {
		const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
		const c1 = corners.has(i % n)
			? [p1[0] + (p2[0] - p1[0]) / 3, p1[1] + (p2[1] - p1[1]) / 3]
			: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
		const c2 = corners.has((i + 1) % n)
			? [p2[0] - (p2[0] - p1[0]) / 3, p2[1] - (p2[1] - p1[1]) / 3]
			: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
		d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
	}
	return `${d}Z`;
}

/* ------------------------------------------------------- polygon difference */

function inside([x, y], poly) {
	let hit = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
	}
	return hit;
}

function segHit(a, b, c, d) {
	const r = [b[0] - a[0], b[1] - a[1]];
	const s = [d[0] - c[0], d[1] - c[1]];
	const den = r[0] * s[1] - r[1] * s[0];
	if (Math.abs(den) < 1e-12) return null;
	const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
	const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
	return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u, p: [a[0] + t * r[0], a[1] + t * r[1]] } : null;
}

/**
 * `subject` minus `cutter`, for two simple polygons whose boundaries cross exactly twice (one bite out of the
 * subject). Returns the subject unchanged when they do not overlap, or null when the subject is swallowed.
 */
export function biteOut(subject, cutter) {
	const hits = [];
	for (let i = 0; i < subject.length; i++) {
		const a = subject[i];
		const b = subject[(i + 1) % subject.length];
		for (let j = 0; j < cutter.length; j++) {
			const h = segHit(a, b, cutter[j], cutter[(j + 1) % cutter.length]);
			if (h) hits.push({ i, j, t: h.t, u: h.u, p: h.p });
		}
	}
	if (hits.length === 0) return subject.every((p) => inside(p, cutter)) ? null : subject;
	if (hits.length !== 2) throw new Error(`biteOut expects 2 crossings, got ${hits.length}`);
	hits.sort((x, y) => x.i + x.t - (y.i + y.t));
	const [h1, h2] = hits;
	// Walk the subject from the crossing where it leaves the cutter to the one where it enters, then follow the
	// cutter's boundary back through the part of it that lies inside the subject.
	const enterFirst = inside(subject[(h1.i + 1) % subject.length], cutter);
	const [leave, enter] = enterFirst ? [h2, h1] : [h1, h2];
	const out = [leave.p];
	const corners = [0];
	for (let k = (leave.i + 1) % subject.length; ; k = (k + 1) % subject.length) {
		out.push(subject[k]);
		if (k === enter.i) break;
	}
	corners.push(out.length);
	out.push(enter.p);
	const step = inside(cutter[(enter.j + 1) % cutter.length], subject) ? 1 : -1;
	let k = step > 0 ? (enter.j + 1) % cutter.length : enter.j;
	const stop = step > 0 ? leave.j : (leave.j + 1) % cutter.length;
	for (let guard = 0; guard <= cutter.length; guard++) {
		out.push(cutter[k]);
		if (k === stop) break;
		k = (k + step + cutter.length) % cutter.length;
	}
	out.corners = corners;
	return out;
}

/* ------------------------------------------------------------- static mark */

/**
 * The keyframe's shapes, each { pts, corners }: the big body, its eyes, the small body with the gap around the big
 * body bitten away, and the small body's eyes. Bodies and eyes are drawn with few points and joined by smooth curves.
 */
export function markShapes({ smallCut = false } = {}) {
	const { big } = MARK;
	const r = big.r * MARK.smallScale;
	const s = orbitPoint(MARK.orbit.keyframe);
	const gap = big.r * (smallCut ? MARK.small.gap : MARK.gap);
	const shapes = [{ pts: bodyPoints(big.cx, big.cy, big.r, { n: 24 }) }];
	const eye = (e) => {
		const k = 6;
		return { pts: capsulePoints(e, 1, k), corners: new Set([0, k, k + 1, 2 * k + 1]), fine: capsulePoints(e, 1, 24) };
	};
	const bigGaze = smallCut ? MARK.small.gaze : MARK.gaze.big;
	for (const e of eyePlacements(
		big.cx,
		big.cy,
		big.r,
		bigGaze.az,
		bigGaze.el,
		smallCut ? MARK.small.eyes : MARK.eyes.big,
	))
		shapes.push(eye(e));
	const fine = biteOut(bodyPoints(s.x, s.y, r, { n: 192 }), bodyPoints(big.cx, big.cy, big.r + gap, { n: 384 }));
	if (fine) {
		const keep = fine.map((_, i) => (fine.corners.includes(i) || i % 8 === 0 ? i : -1)).filter((i) => i >= 0);
		const pts = keep.map((i) => fine[i]);
		const corners = new Set(fine.corners.map((c) => keep.indexOf(c)));
		shapes.push({ pts, corners });
		if (!smallCut) {
			for (const e of eyePlacements(s.x, s.y, r, MARK.gaze.small.az, MARK.gaze.small.el, MARK.eyes.small)) {
				const ey = eye(e);
				if (ey.fine.some((p) => !inside(p, fine))) throw new Error("small body's eye crosses the gap");
				shapes.push(ey);
			}
		}
	}
	return shapes;
}

/** The keyframe as one path with real holes (fill-rule evenodd); draw it in one colour on anything. */
export function markPath(opts) {
	return markShapes(opts)
		.map(({ pts, corners }) => smoothPath(pts, corners))
		.join("");
}

/** Bounding box of the mark, for centring it on tiles. */
export function markBounds(opts) {
	const all = markShapes(opts).flatMap((x) => x.pts);
	const xs = all.map((p) => p[0]);
	const ys = all.map((p) => p[1]);
	return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * The mark as an SVG document.
 * - `color`: the mark's colour; `background`: a tile behind it (omit for transparent).
 * - `smallCut`: the ≤24 px drawing. `fit`: share of the canvas the mark spans when centred on a tile.
 * - `scheme`: "auto" makes the mark follow the viewer's light/dark setting (for favicons).
 */
export function markSVG({
	color = PALETTE.ink,
	background = null,
	radius = 56,
	smallCut = false,
	fit = 0.78,
	scheme = null,
	title = "Yonder",
} = {}) {
	const S = MARK.size;
	const b = markBounds({ smallCut });
	const w = b.x1 - b.x0;
	const h = b.y1 - b.y0;
	const k = background ? (fit * S) / Math.max(w, h) : Math.min(S / w, S / h) * 0.96;
	const tx = S / 2 - k * (b.x0 + w / 2);
	const ty = S / 2 - k * (b.y0 + h / 2);
	// Scoped to a class: an SVG <style> inlined into a page would otherwise restyle every path on it.
	const style =
		scheme === "auto"
			? `<style>.yonder-auto{fill:${color}}@media (prefers-color-scheme:dark){.yonder-auto{fill:${PALETTE.moon}}}</style>`
			: "";
	const tile = background ? `<rect width="${S}" height="${S}" rx="${radius}" fill="${background}"/>` : "";
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="${title}">` +
		`<title>${title}</title>${style}${tile}` +
		`<path${scheme === "auto" ? ' class="yonder-auto"' : ""} transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(4)})" fill="${color}" fill-rule="evenodd" d="${markPath({ smallCut })}"/></svg>\n`
	);
}

/* ------------------------------------------------------------------ motion */

const spring = (x, f, z) => ({ x, v: 0, t: x, f, z });
function stepSpring(s, dt) {
	const w = 2 * Math.PI * s.f;
	s.v += (-2 * s.z * w * s.v - w * w * (s.x - s.t)) * dt;
	s.x += s.v * dt;
}

export const STATES = ["idle", "listen", "work", "done", "sleep", "split"];
const TOUR = [
	["split", 2.6],
	["idle", 5],
	["listen", 4],
	["work", 6.5],
	["done", 2.6],
	["idle", 3.5],
	["sleep", 4.5],
	["idle", 3],
];

/**
 * Bring the mark to life inside an <svg> element. The character rests on the static keyframe and is driven by
 * springs: it breathes, blinks, follows the pointer (`listen`), sends the small body round its orbit (`work`),
 * hops with happy eyes (`done`), sleeps, and buds the small body out of the big one (`split`).
 * Pass `state: "tour"` to cycle through them. Returns { setState, destroy }.
 */
export function createCharacter(svg, { color = PALETTE.ink, state = "idle", pointer = true } = {}) {
	const S = MARK.size;
	svg.setAttribute("viewBox", `0 0 ${S} ${S}`);
	const uid = `ym${Math.random().toString(36).slice(2, 8)}`;
	const R = MARK.big.r;
	const r = R * MARK.smallScale;
	const G = MARK.gaze;
	const sp = {
		bAz: spring(G.big.az, 3.2, 0.7),
		bEl: spring(G.big.el, 3.2, 0.7),
		sAz: spring(G.small.az, 3.8, 0.65),
		sEl: spring(G.small.el, 3.8, 0.65),
		th: spring(MARK.orbit.keyframe, 0.9, 0.9),
		sScale: spring(1, 5, 0.45),
		bSquash: spring(1, 4.5, 0.32),
		sSquash: spring(1, 5.5, 0.3),
		bHop: spring(0, 4, 0.38),
		sHop: spring(0, 4.6, 0.36),
		bLid: spring(1, 14, 0.8),
		sLid: spring(1, 14, 0.8),
	};
	const th0 = MARK.orbit.keyframe;
	const tour = state === "tour";
	let current = tour ? "split" : state;
	let since = 0;
	let tourI = 0;
	let tourAt = 0;
	let ptr = null;
	let last = null;
	let raf = 0;
	let saccadeAt = 2;
	const blinkQ = { b: [], s: [] };
	const nextBlink = { b: 1.6, s: 2.3 };
	const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
	const home = () => Math.round((sp.th.x - th0) / 360) * 360 + th0;

	function queueBlink(q, now) {
		q.push({ at: now, v: 0.06 }, { at: now + 0.09, v: 0.06 }, { at: now + 0.16, v: 1.06 }, { at: now + 0.3, v: 1 });
		if (Math.random() < 0.15) q.push({ at: now + 0.38, v: 0.06 }, { at: now + 0.48, v: 1 });
	}
	function readBlink(q, now) {
		let v = null;
		while (q.length && now >= q[0].at) v = q.shift().v;
		return v;
	}

	function setState(next, now = performance.now() / 1000) {
		current = next;
		since = now;
		if (next === "split") {
			sp.sScale.x = 0.15;
			sp.sScale.v = 0;
			sp.sScale.t = 1;
			sp.th.x = 150;
			sp.th.t = th0 + 360;
			sp.th.f = 0.55;
			sp.bSquash.v -= 1.2;
		} else if (next === "work") {
			sp.th.f = 0.9;
			sp.th.t = sp.th.x + 360;
		} else if (next === "done") {
			sp.bHop.v -= 120;
			setTimeout(() => {
				sp.sHop.v -= 150;
			}, 140);
			sp.bSquash.x = 0.9;
		} else if (next === "sleep") {
			sp.th.t = home() - 80;
		} else {
			sp.th.f = 0.9;
			sp.th.t = home();
		}
	}

	const onMove = (e) => {
		const b = svg.getBoundingClientRect();
		ptr = [((e.clientX - b.left) / b.width) * S, ((e.clientY - b.top) / b.height) * S];
		if (tour && current === "idle") setState("listen");
	};
	const onLeave = () => {
		ptr = null;
	};
	if (pointer) {
		svg.addEventListener("pointermove", onMove);
		svg.addEventListener("pointerleave", onLeave);
	}

	function eyesMask(cx, cy, rad_, az, el, spec, lid, happy) {
		let s = "";
		for (const e of eyePlacements(cx, cy, rad_, az, el, spec)) {
			if (happy) {
				const a = e.w * 0.95;
				const b = e.h * 0.32;
				const deg = (e.phi * 180) / Math.PI;
				const tr = `translate(${e.x.toFixed(2)} ${e.y.toFixed(2)}) rotate(${deg.toFixed(2)}) scale(${e.z.toFixed(3)} 1) rotate(${(-deg).toFixed(2)})`;
				s += `<path d="M${-a} ${b} Q0 ${-b * 2.2} ${a} ${b}" fill="none" stroke="#000" stroke-width="${(e.w * 0.62).toFixed(2)}" stroke-linecap="round" transform="${tr}"/>`;
			} else s += `<path d="${polyPath(capsulePoints(e, lid))}" fill="#000"/>`;
		}
		return s;
	}

	function frame(ms) {
		const now = ms / 1000;
		if (last === null) {
			last = now;
			tourAt = now;
			setState(current, now);
		}
		const dt = Math.min(0.05, now - last);
		last = now;
		const t = now - since;
		if (tour && now - tourAt > TOUR[tourI][1]) {
			tourI = (tourI + 1) % TOUR.length;
			tourAt = now;
			setState(TOUR[tourI][0], now);
		}

		// where each face looks
		const sm = orbitPoint(sp.th.x);
		let bt = G.big;
		let st = G.small;
		if (now > saccadeAt) {
			saccadeAt = now + 1.8 + Math.random() * 2.6;
			sp.bAz.t += (Math.random() - 0.5) * 7;
		}
		if (current === "listen") {
			const p = ptr || [128 + Math.sin(now * 0.9) * 90, 120 + Math.cos(now * 0.7) * 40];
			const look = (cx, cy) => ({ az: clamp((p[0] - cx) / 2.6, -42, 42), el: clamp(-(p[1] - cy) / 3, -32, 32) });
			bt = look(MARK.big.cx, MARK.big.cy);
			st = look(sm.x, sm.y);
		} else if (current === "work") {
			const dx = sm.x - MARK.big.cx;
			const dy = sm.y - MARK.big.cy;
			bt = { az: clamp((dx / R) * 30, -40, 40), el: clamp((-dy / R) * 32, -28, 28) };
			st = { az: clamp((-dx / R) * 30, -40, 40), el: clamp((dy / R) * 26, -28, 28) };
		} else if (current === "sleep") {
			bt = { az: 6, el: -10 };
			st = { az: 10, el: -8 };
		} else if (current === "done") {
			bt = { az: 4, el: 8 };
			st = { az: -8, el: 6 };
		}
		if (current === "listen" || current === "work" || Math.abs(sp.bAz.t - bt.az) > 9) sp.bAz.t = bt.az;
		sp.bEl.t = bt.el;
		sp.sAz.t = st.az;
		sp.sEl.t = st.el;

		// lids
		for (const k of ["b", "s"]) {
			if (now > nextBlink[k] && current !== "sleep") {
				queueBlink(blinkQ[k], now);
				nextBlink[k] = now + 2.4 + Math.random() * 3.4;
				if (k === "b" && Math.random() < 0.35) {
					queueBlink(blinkQ.s, now + 0.05);
					nextBlink.s = now + 2.6 + Math.random() * 3;
				}
			}
			const L = k === "b" ? sp.bLid : sp.sLid;
			const v = readBlink(blinkQ[k], now);
			if (v !== null) L.t = v;
			if (current === "sleep") L.t = 0.06;
			else if (!blinkQ[k].length && L.t < 0.5) L.t = 1;
		}
		const happy = current === "done" && t > 0.15 && t < 2.2;
		if (current === "work" && sp.th.t - sp.th.x < 30 && t > 1) sp.th.t += 360;
		if (!tour && (current === "split" || current === "done") && t > 3) setState(current, now);

		// breath, then integrate
		sp.bSquash.t = 1 + (current === "sleep" ? 0.03 * Math.sin(now * 1.4) : 0.012 * Math.sin(now * 2.1));
		sp.sSquash.t = 1 + 0.014 * Math.sin(now * 2.1 + 1.3);
		sp.bHop.t = 0;
		sp.sHop.t = current === "sleep" ? 2 : 0;
		const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
		for (let i = 0; i < steps; i++) for (const k in sp) stepSpring(sp[k], dt / steps);
		if (reduce) {
			for (const k in sp) {
				sp[k].x = sp[k].t;
				sp[k].v = 0;
			}
		}
		if (sp.bHop.x > -1 && sp.bHop.v > 60) sp.bSquash.v -= 2;
		if (sp.sHop.x > -1 && sp.sHop.v > 60) sp.sSquash.v -= 2;

		// draw: each body is one shape with its eyes masked out; whichever is behind is masked by the other's gap
		const o = orbitPoint(sp.th.x);
		const depth = (1 + 0.16 * Math.sin(rad(sp.th.x))) / (1 + 0.16 * Math.sin(rad(th0)));
		const sx = o.x + Math.sin(now * 0.6) * 1.2;
		const sy = o.y + (current === "sleep" ? 0 : Math.sin(now * 0.85) * 1.6) + sp.sHop.x;
		const rs = r * clamp(sp.sScale.x, 0.05, 1.3) * depth;
		const bq = sp.bSquash.x;
		const sq = sp.sSquash.x;
		const bx = MARK.big.cx;
		const by = MARK.big.cy + sp.bHop.x;
		const gap = R * MARK.gap;
		const big = polyPath(bodyPoints(bx, by, R, { sx: 1 / Math.sqrt(bq), sy: bq, n: 96 }));
		const bigHalo = polyPath(bodyPoints(bx, by, R + gap, { sx: 1 / Math.sqrt(bq), sy: bq, n: 96 }));
		const small = polyPath(bodyPoints(sx, sy, rs, { sx: 1 / Math.sqrt(sq), sy: sq, n: 72 }));
		const smallHalo = polyPath(bodyPoints(sx, sy, rs + gap, { sx: 1 / Math.sqrt(sq), sy: sq, n: 72 }));
		const front = o.ly > 0 && Math.abs(sp.th.x - th0) % 360 > 1;
		const bigEyes = eyesMask(bx, by - R * (1 - bq) * 0.5, R, sp.bAz.x, sp.bEl.x, MARK.eyes.big, sp.bLid.x, happy);
		const smallEyes = rs > r * 0.5 ? eyesMask(sx, sy, rs, sp.sAz.x, sp.sEl.x, MARK.eyes.small, sp.sLid.x, happy) : "";
		const full = `<rect width="${S}" height="${S}" fill="#fff"/>`;
		svg.innerHTML =
			`<defs><mask id="${uid}b" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}">${full}${bigEyes}${front ? `<path d="${smallHalo}" fill="#000"/>` : ""}</mask>` +
			`<mask id="${uid}s" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}">${full}${smallEyes}${front ? "" : `<path d="${bigHalo}" fill="#000"/>`}</mask></defs>` +
			`<path d="${big}" fill="${color}" mask="url(#${uid}b)"/><path d="${small}" fill="${color}" mask="url(#${uid}s)"/>`;
		raf = requestAnimationFrame(frame);
	}
	raf = requestAnimationFrame(frame);

	return {
		setState: (s) => setState(s),
		destroy() {
			cancelAnimationFrame(raf);
			svg.removeEventListener("pointermove", onMove);
			svg.removeEventListener("pointerleave", onLeave);
		},
	};
}
