/* =========================================================================
   scrapbook.js — interactive bits for the moodboard (vanilla, no deps)
   -------------------------------------------------------------------------
   1. Today's date + page number in the header
   2. Shuffle: click / tap empty paper level with the upper shuffle zone and
      the doodles + every [data-shuffle] block glide to new spots
   3. Polaroids: random tilt + lift/caption on hover
   4. Line-draw animation for [data-draw] SVGs
   5. Chandigarh ⇄ Patiala paper-plane flight
   6. Social links fade-in-up on scroll
   ========================================================================= */

(() => {
	'use strict';

	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const rand = (min, max) => Math.random() * (max - min) + min;


	/* 1. TODAY'S DATE ------------------------------------------------------ */
	// Fills every [data-today] element with the visitor's local date, e.g.
	// "september 14, 2026 · page 257" — the page number is the day of the year.
	function initDate() {
		const now = new Date();
		const year = now.getFullYear();
		const month = now.getMonth();
		const day = now.getDate();

		const dateText = now
			.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
			.toLowerCase();

		// Count days using UTC midnights so daylight-saving shifts can't skew the result.
		const dayOfYear = Math.round((Date.UTC(year, month, day) - Date.UTC(year, 0, 0)) / 86400000);
		const page = String(dayOfYear).padStart(2, '0');
		const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

		document.querySelectorAll('[data-today]').forEach((el) => {
			el.textContent = `${dateText} · page ${page}`;
			if (el.tagName === 'TIME') el.dateTime = isoDate;
		});
	}


	/* 2. SHUFFLE ----------------------------------------------------------- */
	const DOODLE_PADDING = 16;  // keep doodles at least this far from the page edges
	const PIECE_GAP = 14;       // breathing room kept between shuffled blocks
	const SCAN_STEP = 10;       // px between candidate spots when looking for free room
	const LAYOUT_RETRIES = 25;  // whole-layout attempts before settling for the least overlap
	const TAP_MAX_MOVE = 10;    // px a finger may drift and still count as a tap (not a scroll)
	const TAP_MAX_MS = 500;
	const GHOST_CLICK_MS = 700; // browsers send a click right after a tap; ignore it

	const shuffleArray = (array) => {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[array[i], array[j]] = [array[j], array[i]];
		}
		return array;
	};

	// Doodles: scattered anywhere on the page. Returns the scatter function.
	function setupDoodles() {
		const layer = document.querySelector('.doodle-layer');
		if (!layer) return () => {};
		const doodles = [...layer.querySelectorAll('.doodle')];

		// The CSS transition on `transform` turns each move into a smooth glide.
		function scatter() {
			const width = layer.clientWidth;
			const height = layer.clientHeight;

			doodles.forEach((doodle) => {
				const box = doodle.getBoundingClientRect();
				const size = Math.max(box.width, box.height);
				const x = rand(DOODLE_PADDING, Math.max(DOODLE_PADDING, width - size - DOODLE_PADDING));
				const y = rand(DOODLE_PADDING, Math.max(DOODLE_PADDING, height - size - DOODLE_PADDING));
				const angle = rand(-30, 30);

				doodle.style.setProperty('--delay', `${Math.round(rand(0, 160))}ms`);
				doodle.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${angle.toFixed(1)}deg)`;
			});
		}

		// First placement happens without a transition, then they fade in.
		layer.classList.add('is-placing');
		scatter();
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				layer.classList.remove('is-placing');
				layer.classList.add('is-ready');
			});
		});

		return scatter;
	}

	// Blocks: every [data-shuffle] element inside the zone moves to a new spot
	// within the zone's box without covering its neighbours. Blocks keep their
	// home spot in the layout and are offset with the CSS `translate` property,
	// so their own rotate/scale transforms (photo hover!) still work.
	function setupBlocks(zone) {
		const blocks = zone ? [...zone.querySelectorAll('[data-shuffle]')] : [];
		let shuffled = false;

		// Overlap area of two boxes, counting anything closer than PIECE_GAP as touching.
		const overlapArea = (a, b) => {
			const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + PIECE_GAP;
			const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + PIECE_GAP;
			return w > 0 && h > 0 ? w * h : 0;
		};

		// Roomy zones (desktop): free-form scatter. Biggest blocks go first; each takes
		// a random free spot from a grid of candidates. If a layout can't avoid every
		// overlap, start over, keeping the best attempt.
		function scatterLayout(items, zoneWidth, zoneHeight) {
			const bySize = [...items].sort((a, b) => b.w * b.h - a.w * a.h);
			let best = null;
			let bestOverlap = Infinity;

			for (let attempt = 0; attempt < LAYOUT_RETRIES && bestOverlap > 0; attempt++) {
				const placed = [];
				let layoutOverlap = 0;

				bySize.forEach((item) => {
					const maxX = Math.max(0, zoneWidth - item.w);
					const maxY = Math.max(0, zoneHeight - item.h);
					const spots = [];
					for (let x = Math.min(rand(0, SCAN_STEP), maxX); x <= maxX; x += SCAN_STEP) {
						for (let y = Math.min(rand(0, SCAN_STEP), maxY); y <= maxY; y += SCAN_STEP) spots.push([x, y]);
					}
					shuffleArray(spots);

					let spot = null;
					for (const [x, y] of spots) {
						const candidate = { item, x, y, w: item.w, h: item.h };
						candidate.overlap = placed.reduce((sum, other) => sum + overlapArea(candidate, other), 0);
						if (!spot || candidate.overlap < spot.overlap) spot = candidate;
						if (candidate.overlap === 0) break;
					}
					placed.push(spot);
					layoutOverlap += spot.overlap;
				});

				if (layoutOverlap < bestOverlap) {
					best = placed;
					bestOverlap = layoutOverlap;
				}
			}
			return best;
		}

		// Crowded zones (phones/tablets), where text blocks span the whole width and a
		// free-form scatter would pile photos on top of text: shuffle the order instead.
		// Wide blocks get a row each, narrow ones (photos) share rows side by side, the
		// rows stack in random order, and the spare height is sprinkled between them.
		function stackLayout(items, zoneWidth, zoneHeight) {
			const rows = items.filter((item) => item.w > zoneWidth / 2).map((item) => [item]);
			let row = [];
			let rowWidth = 0;
			shuffleArray(items.filter((item) => item.w <= zoneWidth / 2)).forEach((item) => {
				if (row.length && rowWidth + PIECE_GAP + item.w > zoneWidth) {
					rows.push(row);
					row = [];
					rowWidth = 0;
				}
				rowWidth += (row.length ? PIECE_GAP : 0) + item.w;
				row.push(item);
			});
			if (row.length) rows.push(row);
			shuffleArray(rows);

			const rowHeights = rows.map((r) => Math.max(...r.map((item) => item.h)));
			const spare = Math.max(0, zoneHeight - rowHeights.reduce((sum, h) => sum + h, 0));
			// how much of the spare height goes above each row (plus a little left at the bottom)
			const weights = rows.map((_, i) => (i === 0 ? rand(0, 0.3) : rand(0.6, 1.4)));
			const weightTotal = weights.reduce((sum, w) => sum + w, 0) + rand(0, 0.3);

			const placed = [];
			let y = 0;
			rows.forEach((r, i) => {
				y += (spare * weights[i]) / weightTotal;
				const usedWidth = r.reduce((sum, item) => sum + item.w, 0) + PIECE_GAP * (r.length - 1);
				let x = rand(0, Math.max(0, zoneWidth - usedWidth));
				r.forEach((item) => {
					placed.push({ item, x, y: y + rand(0, rowHeights[i] - item.h) });
					x += item.w + PIECE_GAP;
				});
				y += rowHeights[i];
			});
			return placed;
		}

		function shuffle() {
			if (!blocks.length) return;
			const zoneWidth = zone.clientWidth;
			const zoneHeight = zone.clientHeight;

			// offsetLeft/Top are the untranslated home position inside the zone
			const items = blocks.map((el) => ({ el, homeX: el.offsetLeft, homeY: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }));
			const crowded = items.some((item) => item.w > zoneWidth * 0.75);
			const layout = crowded ? stackLayout(items, zoneWidth, zoneHeight) : scatterLayout(items, zoneWidth, zoneHeight);

			layout.forEach(({ item, x, y }) => {
				item.el.style.setProperty('--delay', `${Math.round(rand(0, 160))}ms`);
				item.el.style.translate = `${(x - item.homeX).toFixed(1)}px ${(y - item.homeY).toFixed(1)}px`;
			});

			shuffled = true;
		}

		return { shuffle, isShuffled: () => shuffled };
	}

	function initShuffle() {
		const zone = document.querySelector('[data-zone="shuffle"]');
		const scatterDoodles = setupDoodles();
		const blocks = setupBlocks(zone);
		if (!zone) return;

		const reshuffle = () => {
			scatterDoodles();
			blocks.shuffle();
		};

		// A spot counts only if it's truly empty paper — <html>, <body>, or a wrapper
		// marked data-bg, never text, photos or links — AND it's level with the
		// shuffle zone. So the paper around the header, projects, cities and links is inert.
		function isShuffleSpot(target, clientY) {
			const isPaper =
				target === document.body ||
				target === document.documentElement ||
				(target instanceof Element && target.hasAttribute('data-bg'));
			if (!isPaper) return false;
			const bounds = zone.getBoundingClientRect();
			return clientY >= bounds.top && clientY <= bounds.bottom;
		}

		// Mouse / trackpad (and the click that follows a tap, which we skip — see below).
		let lastTapShuffle = 0;
		document.addEventListener('click', (event) => {
			if (Date.now() - lastTapShuffle < GHOST_CLICK_MS) return;
			if (isShuffleSpot(event.target, event.clientY)) reshuffle();
		});

		// Touch: touchstart remembers where the finger landed; touchend reshuffles only if
		// it was a quick tap that didn't move (so scrolling the page never reshuffles).
		let touch = null;
		document.addEventListener('touchstart', (event) => {
			if (event.touches.length !== 1) {
				touch = null;
				return;
			}
			const point = event.touches[0];
			touch = { x: point.clientX, y: point.clientY, time: Date.now(), target: event.target };
		}, { passive: true });

		document.addEventListener('touchmove', (event) => {
			if (!touch) return;
			const point = event.touches[0];
			if (Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > TAP_MAX_MOVE) touch = null;
		}, { passive: true });

		document.addEventListener('touchend', () => {
			if (touch && Date.now() - touch.time < TAP_MAX_MS && isShuffleSpot(touch.target, touch.y)) {
				lastTapShuffle = Date.now();
				reshuffle();
			}
			touch = null;
		}, { passive: true });

		document.addEventListener('touchcancel', () => {
			touch = null;
		}, { passive: true });

		// Re-fit everything when the page width changes. (Mobile browsers also fire
		// resize when the toolbar hides during scrolling — the width check skips those.)
		let lastWidth = window.innerWidth;
		let resizeTimer;
		window.addEventListener('resize', () => {
			if (window.innerWidth === lastWidth) return;
			lastWidth = window.innerWidth;
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				scatterDoodles();
				if (blocks.isShuffled()) blocks.shuffle();
			}, 250);
		});
	}


	/* 3. POLAROIDS --------------------------------------------------------- */
	function initPolaroids() {
		document.querySelectorAll('.polaroid').forEach((card) => {
			// Random tilt between 1.5° and 6° either way, unless one is set inline.
			if (!card.style.getPropertyValue('--rot')) {
				const sign = Math.random() < 0.5 ? -1 : 1;
				card.style.setProperty('--rot', `${(sign * rand(1.5, 6)).toFixed(1)}deg`);
			}

			const lift = () => card.classList.add('is-lifted');
			const drop = () => card.classList.remove('is-lifted');

			card.addEventListener('mouseenter', lift);
			card.addEventListener('mouseleave', drop);
			card.addEventListener('focus', lift); // keyboard users
			card.addEventListener('blur', drop);

			// Touch screens have no hover: tap toggles the popup instead.
			card.addEventListener('pointerup', (event) => {
				if (event.pointerType === 'touch') card.classList.toggle('is-lifted');
			});
		});
	}


	/* 4. LINE-DRAW ANIMATION ----------------------------------------------- */
	const DRAWABLE = 'path, line, polyline, polygon, rect, circle, ellipse';

	function initDrawOn() {
		const groups = [...document.querySelectorAll('[data-draw]')];
		if (!groups.length) return;

		// Measure each stroke so CSS can hide it with stroke-dasharray/offset.
		groups.forEach((group) => {
			group.querySelectorAll(DRAWABLE).forEach((shape, i) => {
				shape.style.setProperty('--len', `${shape.getTotalLength().toFixed(1)}px`);
				shape.style.setProperty('--i', i);
			});
			group.classList.add('draw-ready');
		});

		const draw = (group) => group.classList.add('is-drawn');

		if (reducedMotion || !('IntersectionObserver' in window)) {
			groups.forEach(draw);
			return;
		}

		// Observe the outer <svg> of each group (the underline <svg> is its own root).
		const groupsBySvg = new Map();
		groups.forEach((group) => {
			const svg = group.ownerSVGElement || group;
			if (!groupsBySvg.has(svg)) groupsBySvg.set(svg, []);
			groupsBySvg.get(svg).push(group);
		});

		const observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (!entry.isIntersecting) return;
				// Double rAF so the hidden state is painted before the transition starts.
				requestAnimationFrame(() => requestAnimationFrame(() => groupsBySvg.get(entry.target).forEach(draw)));
				observer.unobserve(entry.target);
			});
		}, { threshold: 0.3 });

		groupsBySvg.forEach((_, svg) => observer.observe(svg));
	}


	/* 5. CHANDIGARH ⇄ PATIALA FLIGHT --------------------------------------- */
	const FLIGHT_MS = 1800; // time for a full city-to-city flight

	function initFlight() {
		const stage = document.querySelector('.route-stage');
		if (!stage) return;

		const path = stage.querySelector('#flight-path');
		const plane = stage.querySelector('#plane');
		const zones = stage.querySelectorAll('.route-zone');
		const totalLength = path.getTotalLength();

		let progress = 0;         // 0 = parked at Chandigarh (left), 1 = parked at Patiala (right)
		let currentTarget = null; // where an in-progress flight is heading
		let rafId = null;
		let hopTimer = null;

		const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

		// Put the plane at `p` along the path, nose pointing in the travel direction.
		function placePlane(p, heading) {
			const at = p * totalLength;
			const point = path.getPointAtLength(at);
			const behind = path.getPointAtLength(Math.max(0, at - 1));
			const ahead = path.getPointAtLength(Math.min(totalLength, at + 1));
			let angle = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI;
			if (heading < 0) angle += 180; // flying back towards Chandigarh
			plane.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(1)})`);
		}

		function animateTo(target) {
			cancelAnimationFrame(rafId);
			const start = progress;
			const heading = Math.sign(target - start) || 1;
			const duration = reducedMotion ? 0 : FLIGHT_MS * Math.abs(target - start);
			const startTime = performance.now();

			currentTarget = target;
			stage.classList.add('is-flying');

			const step = (now) => {
				const t = duration ? Math.min(1, (now - startTime) / duration) : 1;
				progress = start + (target - start) * easeInOut(t);
				placePlane(progress, heading);

				if (t < 1) {
					rafId = requestAnimationFrame(step);
				} else {
					rafId = null;
					currentTarget = null;
					stage.classList.remove('is-flying');
				}
			};
			rafId = requestAnimationFrame(step);
		}

		// target: 1 = fly to Patiala, 0 = fly to Chandigarh
		function fly(target) {
			if (currentTarget === target) return; // already heading there

			// Cancel a pending "hop" if the other zone was triggered meanwhile.
			if (hopTimer) {
				clearTimeout(hopTimer);
				hopTimer = null;
				plane.classList.remove('is-hidden');
			}

			const parkedAtDestination = rafId === null && Math.abs(progress - target) < 0.001;
			if (!parkedAtDestination) {
				// Either parked at the origin, or mid-flight: fly (or turn around) from here.
				animateTo(target);
				return;
			}

			// Plane is already at the destination: fade out, reappear at the origin, then fly.
			const origin = 1 - target;
			plane.classList.add('is-hidden');
			hopTimer = setTimeout(() => {
				hopTimer = null;
				progress = origin;
				placePlane(progress, target - origin);
				plane.classList.remove('is-hidden');
				animateTo(target);
			}, reducedMotion ? 0 : 220);
		}

		placePlane(0, 1); // start parked at Chandigarh

		zones.forEach((zone) => {
			const trigger = () => fly(Number(zone.dataset.target));
			zone.addEventListener('pointerenter', trigger);
			zone.addEventListener('focus', trigger);
			zone.addEventListener('click', trigger);
		});
	}


	/* 6. SOCIAL LINKS ------------------------------------------------------ */
	function initSocials() {
		const items = document.querySelectorAll('.social-item');
		const reveal = (item) => item.classList.add('animated', 'fadeInUp'); // from animate.css

		if (!('IntersectionObserver' in window)) {
			items.forEach(reveal);
			return;
		}

		const observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (!entry.isIntersecting) return;
				reveal(entry.target);
				observer.unobserve(entry.target);
			});
		}, { threshold: 0.2 });

		items.forEach((item) => observer.observe(item));
	}


	/* GO ------------------------------------------------------------------- */
	initDate();
	initShuffle();
	initPolaroids();
	initDrawOn();
	initFlight();
	initSocials();
})();
