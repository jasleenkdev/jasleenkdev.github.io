/* =========================================================================
   scrapbook.js — interactive bits for the moodboard (vanilla, no deps)
   -------------------------------------------------------------------------
   1. Today's date + page number in the header
   2. Shuffle: click / tap empty paper anywhere on the page and
      the doodles + every [data-shuffle] block glide to new spots
   3. Polaroids: random tilt + lift/caption on hover
   4. Line-draw animation for [data-draw] SVGs
   5. Chandigarh ⇄ Patiala paper-plane flight
   6. Social links fade-in-up on scroll
   7. Audio: background music toggle + a click sound on every click
   ========================================================================= */

   (() => {
	'use strict';

	const reducedMotion =
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	const rand = (min, max) =>
		Math.random() * (max - min) + min;


	/* 1. TODAY'S DATE ------------------------------------------------------ */

	// Fills every [data-today] element with the visitor's local date.
	function initDate() {
		const now = new Date();

		const year = now.getFullYear();
		const month = now.getMonth();
		const day = now.getDate();

		const dateText = now
			.toLocaleDateString('en-US', {
				month: 'long',
				day: 'numeric',
				year: 'numeric'
			})
			.toLowerCase();

		// Count days using UTC midnights so daylight-saving shifts
		// can't skew the result.
		const dayOfYear = Math.round(
			(Date.UTC(year, month, day) -
				Date.UTC(year, 0, 0)) /
			86400000
		);

		const page = String(dayOfYear).padStart(2, '0');

		const isoDate =
			`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

		document.querySelectorAll('[data-today]').forEach((el) => {
			el.textContent = `${dateText} · page ${page}`;

			if (el.tagName === 'TIME') {
				el.dateTime = isoDate;
			}
		});
	}


	/* 2. SHUFFLE ----------------------------------------------------------- */

	const DOODLE_PADDING = 24;
	const PIECE_GAP = 14;
	const SCAN_STEP = 10;
	const LAYOUT_RETRIES = 25;
	const LAYOUT_BUDGET_MS = 12;
	const MAX_STAGGER_MS = 50;

	const TAP_MAX_MOVE = 10;
	const TAP_MAX_MS = 500;
	const GHOST_CLICK_MS = 700;


	/* ---------------------------------------------------------
	   SHUFFLE HELPERS
	   --------------------------------------------------------- */

	const shuffleArray = (array) => {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));

			[array[i], array[j]] =
				[array[j], array[i]];
		}

		return array;
	};


	const gcd = (a, b) =>
		b ? gcd(b, a % b) : a;


	/* ---------------------------------------------------------
	   DOODLES
	   --------------------------------------------------------- */

	function setupDoodles() {
		const layer =
			document.querySelector('.doodle-layer');

		if (!layer) return () => {};

		const doodles =
			[...layer.querySelectorAll('.doodle')];

		/*
		 * IMPORTANT:
		 *
		 * Move the doodle layer directly underneath <body>
		 * so it cannot be constrained by a grid column,
		 * sidebar, section, or other parent container.
		 */
		if (layer.parentElement !== document.body) {
			document.body.appendChild(layer);
		}


		/*
		 * The layer covers the entire page.
		 *
		 * `inset: 0` stretches it to <body>'s box, so the layer is
		 * always exactly as big as the content currently measures and
		 * JS never writes a pixel height here.
		 *
		 * That matters. The layer is an absolutely positioned child of
		 * <body>, so it counts towards document.scrollHeight but NOT
		 * towards <body>'s own auto height. A hard-coded height would
		 * therefore be read straight back as "the page height" the next
		 * time anything measured the document, and the page could only
		 * ever grow — which is what left blank scroll space under the
		 * footer. See getPageSize() below.
		 *
		 * overflow: hidden stops a doodle near an edge from adding
		 * scrollable area of its own.
		 */
		layer.style.position = 'absolute';
		layer.style.inset = '0';
		layer.style.pointerEvents = 'none';
		layer.style.zIndex = '0';
		layer.style.overflow = 'hidden';


		/*
		 * Doodles are positioned from the top-left of the
		 * full-page layer.
		 */
		doodles.forEach((doodle) => {
			doodle.style.position = 'absolute';
			doodle.style.left = '0';
			doodle.style.top = '0';
			doodle.style.pointerEvents = 'none';
			doodle.style.willChange = 'transform';
		});


		/*
		 * How much room one doodle needs, measured fresh on every
		 * scatter instead of once at startup — at startup the web
		 * fonts and images are still arriving, and a size captured
		 * then can be wrong for the rest of the page's life.
		 *
		 * getComputedStyle reports the LAYOUT size, which ignores the
		 * transform we set below. getBoundingClientRect() would hand
		 * back the ROTATED box instead, so every shuffle would think
		 * the doodle had grown a little and the usable range would
		 * creep inwards.
		 *
		 * The multiplier gives enough room for rotation so
		 * doodles don't get pushed outside the page edges.
		 */
		function doodleSize(doodle) {
			const style =
				getComputedStyle(doodle);

			return Math.max(
				parseFloat(style.width) || 0,
				parseFloat(style.height) || 0
			) * 1.37;
		}


		/* -----------------------------------------------------
		   PAGE SIZE
		   ----------------------------------------------------- */

		/*
		 * The box a scatter is allowed to use.
		 *
		 * This reads the layer itself rather than
		 * document.scrollHeight, so the number can never include the
		 * layer's own size: <body> stretches the layer, the layer
		 * never stretches <body>. Measuring here also means the
		 * numbers are re-read on every scatter, so a late web font or
		 * image that reflows the page is picked up automatically.
		 */
		function getPageSize() {
			return {
				width: layer.clientWidth,
				height: layer.clientHeight
			};
		}


		/* -----------------------------------------------------
		   SCATTER DOODLES
		   ----------------------------------------------------- */

		/*
		 * The page box the current placement was drawn from, so a
		 * later reflow can be told apart from a stray event.
		 */
		let lastBox = {
			width: 0,
			height: 0
		};


		function scatter() {
			const {
				width: pageWidth,
				height: pageHeight
			} = getPageSize();


			lastBox = {
				width: pageWidth,
				height: pageHeight
			};


			doodles.forEach((doodle) => {
				const size =
					doodleSize(doodle);


				const maxX = Math.max(
					DOODLE_PADDING,
					pageWidth -
						size -
						DOODLE_PADDING
				);


				const maxY = Math.max(
					DOODLE_PADDING,
					pageHeight -
						size -
						DOODLE_PADDING
				);


				/*
				 * Random position anywhere across
				 * the ENTIRE page.
				 *
				 * Each click draws a brand new value
				 * from the same fixed range — nothing
				 * is measured from, or added to, where
				 * the doodle happens to be sitting
				 * now, so repeated clicks cannot walk
				 * the doodles off in one direction.
				 */
				const x =
					rand(
						DOODLE_PADDING,
						maxX
					);

				const y =
					rand(
						DOODLE_PADDING,
						maxY
					);


				const angle =
					rand(-30, 30);


				doodle.style.setProperty(
					'--delay',
					`${Math.round(
						rand(
							0,
							MAX_STAGGER_MS
						)
					)}ms`
				);


				doodle.style.transform =
					`translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ` +
					`rotate(${angle.toFixed(1)}deg)`;
			});
		}


		/*
		 * Initial placement happens without animation,
		 * then normal transitions are enabled.
		 */
		layer.classList.add('is-placing');

		scatter();


		requestAnimationFrame(() => {
			requestAnimationFrame(() => {

				layer.classList.remove(
					'is-placing'
				);

				layer.classList.add(
					'is-ready'
				);
			});
		});


		/* -----------------------------------------------------
		   RE-MEASURE ONCE THE PAGE HAS SETTLED
		   ----------------------------------------------------- */

		/*
		 * This file is `defer`red, so it runs at DOMContentLoaded —
		 * before the web fonts and the lazy photos have arrived. Those
		 * reflow the page when they land, which makes every bound
		 * measured up to that point stale.
		 *
		 * So: measure again when the page finishes loading, when the
		 * fonts swap in, and when a lazy image decodes. Re-scatter only
		 * if the page box actually changed, otherwise the doodles would
		 * jump about for no reason while someone is reading.
		 */
		let settleTimer;

		const rescatterIfResized = () => {

			clearTimeout(settleTimer);

			settleTimer =
				setTimeout(() => {

					const {
						width,
						height
					} = getPageSize();


					if (
						Math.abs(
							width -
								lastBox.width
						) < 2 &&
						Math.abs(
							height -
								lastBox.height
						) < 2
					) {
						return;
					}


					scatter();

				}, 100);
		};


		window.addEventListener(
			'load',
			rescatterIfResized
		);


		if (document.fonts) {
			document.fonts.ready.then(
				rescatterIfResized
			);
		}


		document
			.querySelectorAll('img')
			.forEach((img) => {

				if (img.complete) return;

				img.addEventListener(
					'load',
					rescatterIfResized,
					{ once: true }
				);
			});


		/*
		 * Catch-all for anything else that changes the page height
		 * later on. <body> stretches the layer, so watching <body>
		 * covers every reflow; the doodles themselves can't trigger
		 * this, because they are absolutely positioned and clipped.
		 */
		if (typeof ResizeObserver === 'function') {

			new ResizeObserver(
				rescatterIfResized
			).observe(document.body);
		}


		return scatter;
	}


	/* ---------------------------------------------------------
	   SHUFFLE BLOCKS
	   --------------------------------------------------------- */

	function setupBlocks(zone) {

		const blocks =
			zone
				? [...zone.querySelectorAll(
					'[data-shuffle]'
				)]
				: [];


		let shuffled = false;


		/*
		 * Calculate overlap between two rectangles.
		 */
		const overlapArea =
			(x, y, w, h, other) => {

				const overlapW =
					Math.min(
						x + w,
						other.x + other.w
					)
					-
					Math.max(
						x,
						other.x
					)
					+
					PIECE_GAP;


				const overlapH =
					Math.min(
						y + h,
						other.y + other.h
					)
					-
					Math.max(
						y,
						other.y
					)
					+
					PIECE_GAP;


				return (
					overlapW > 0 &&
					overlapH > 0
				)
					? overlapW * overlapH
					: 0;
			};


		/* -----------------------------------------------------
		   DESKTOP / ROOMY LAYOUT
		   ----------------------------------------------------- */

		function scatterLayout(
			items,
			zoneWidth,
			zoneHeight
		) {

			const bySize =
				[...items].sort(
					(a, b) =>
						b.w * b.h -
						a.w * a.h
				);


			const deadline =
				performance.now() +
				LAYOUT_BUDGET_MS;


			let best = null;
			let bestOverlap = Infinity;


			for (
				let attempt = 0;
				attempt < LAYOUT_RETRIES &&
				bestOverlap > 0;
				attempt++
			) {

				if (
					attempt > 0 &&
					performance.now() >
						deadline
				) {
					break;
				}


				const placed = [];
				let layoutOverlap = 0;


				bySize.forEach((item) => {

					const maxX =
						Math.max(
							0,
							zoneWidth -
								item.w
						);


					const maxY =
						Math.max(
							0,
							zoneHeight -
								item.h
						);


					const offsetX =
						rand(
							0,
							Math.min(
								SCAN_STEP,
								maxX
							)
						);


					const offsetY =
						rand(
							0,
							Math.min(
								SCAN_STEP,
								maxY
							)
						);


					const cols =
						Math.floor(
							(maxX - offsetX) /
							SCAN_STEP
						) + 1;


					const rows =
						Math.floor(
							(maxY - offsetY) /
							SCAN_STEP
						) + 1;


					const count =
						cols * rows;


					/*
					 * Visit candidate positions
					 * in a randomized order.
					 */
					let stride =
						Math.max(
							1,
							Math.round(
								count * 0.618
							)
						);


					while (
						gcd(
							stride,
							count
						) !== 1
					) {
						stride++;
					}


					const start =
						Math.floor(
							Math.random() *
							count
						);


					let spot = null;


					for (
						let k = 0;
						k < count;
						k++
					) {

						const index =
							(start +
								k * stride) %
							count;


						const x =
							offsetX +
							(index % cols) *
							SCAN_STEP;


						const y =
							offsetY +
							Math.floor(
								index / cols
							) *
							SCAN_STEP;


						let overlap = 0;


						for (
							let p = 0;
							p < placed.length &&
							(
								!spot ||
								overlap <
									spot.overlap
							);
							p++
						) {

							overlap +=
								overlapArea(
									x,
									y,
									item.w,
									item.h,
									placed[p]
								);
						}


						if (
							!spot ||
							overlap <
								spot.overlap
						) {

							spot = {
								item,
								x,
								y,
								w: item.w,
								h: item.h,
								overlap
							};
						}


						if (
							overlap === 0
						) {
							break;
						}
					}


					placed.push(spot);

					layoutOverlap +=
						spot.overlap;
				});


				if (
					layoutOverlap <
					bestOverlap
				) {

					best = placed;
					bestOverlap =
						layoutOverlap;
				}
			}


			return best;
		}


		/* -----------------------------------------------------
		   MOBILE / CROWDED LAYOUT
		   ----------------------------------------------------- */

		function stackLayout(
			items,
			zoneWidth,
			zoneHeight
		) {

			const rows =
				items
					.filter(
						(item) =>
							item.w >
							zoneWidth / 2
					)
					.map((item) => [item]);


			let row = [];
			let rowWidth = 0;


			shuffleArray(
				items.filter(
					(item) =>
						item.w <=
						zoneWidth / 2
				)
			).forEach((item) => {

				if (
					row.length &&
					rowWidth +
						PIECE_GAP +
						item.w >
						zoneWidth
				) {

					rows.push(row);

					row = [];
					rowWidth = 0;
				}


				rowWidth +=
					(
						row.length
							? PIECE_GAP
							: 0
					) +
					item.w;


				row.push(item);
			});


			if (row.length) {
				rows.push(row);
			}


			shuffleArray(rows);


			const rowHeights =
				rows.map((r) =>
					Math.max(
						...r.map(
							(item) =>
								item.h
						)
					)
				);


			const spare =
				Math.max(
					0,
					zoneHeight -
						rowHeights.reduce(
							(sum, h) =>
								sum + h,
							0
						)
				);


			const weights =
				rows.map(
					(_, i) =>
						i === 0
							? rand(0, 0.3)
							: rand(0.6, 1.4)
				);


			const weightTotal =
				weights.reduce(
					(sum, w) =>
						sum + w,
					0
				) +
				rand(0, 0.3);


			const placed = [];

			let y = 0;


			rows.forEach((r, i) => {

				y +=
					(spare *
						weights[i]) /
					weightTotal;


				const usedWidth =
					r.reduce(
						(sum, item) =>
							sum + item.w,
						0
					) +
					PIECE_GAP *
						(r.length - 1);


				let x =
					rand(
						0,
						Math.max(
							0,
							zoneWidth -
								usedWidth
						)
					);


				r.forEach((item) => {

					placed.push({
						item,
						x,
						y:
							y +
							rand(
								0,
								Math.max(
									0,
									rowHeights[i] -
										item.h
								)
							)
					});


					x +=
						item.w +
						PIECE_GAP;
				});


				y += rowHeights[i];
			});


			return placed;
		}


		/* -----------------------------------------------------
		   SHUFFLE THE BLOCKS
		   ----------------------------------------------------- */

		function shuffle() {

			if (!blocks.length) {
				return;
			}


			const zoneWidth =
				zone.clientWidth;

			const zoneHeight =
				zone.clientHeight;


			/*
			 * offsetLeft / offsetTop represent the
			 * original/home position of each block.
			 */
			const items =
				blocks.map((el) => ({
					el,

					homeX:
						el.offsetLeft,

					homeY:
						el.offsetTop,

					w:
						el.offsetWidth,

					h:
						el.offsetHeight
				}));


			const crowded =
				items.some(
					(item) =>
						item.w >
						zoneWidth * 0.75
				);


			const layout =
				crowded
					? stackLayout(
						items,
						zoneWidth,
						zoneHeight
					)
					: scatterLayout(
						items,
						zoneWidth,
						zoneHeight
					);


			if (!layout) {
				return;
			}


			layout.forEach(
				({ item, x, y }) => {

					item.el.style.setProperty(
						'--delay',
						`${Math.round(
							rand(
								0,
								MAX_STAGGER_MS
							)
						)}ms`
					);


					/*
					 * CSS translate is used instead of
					 * transform so existing rotation/
					 * scale transforms remain intact.
					 */
					item.el.style.translate =
						`${(
							x -
							item.homeX
						).toFixed(1)}px ` +
						`${(
							y -
							item.homeY
						).toFixed(1)}px`;
				}
			);


			shuffled = true;
		}


		return {
			shuffle,
			isShuffled: () =>
				shuffled
		};
	}


	/* ---------------------------------------------------------
	   INITIALIZE SHUFFLE
	   --------------------------------------------------------- */

	function initShuffle() {

		const zone =
			document.querySelector(
				'[data-zone="shuffle"]'
			);


		/*
		 * setupDoodles() now creates a full-page
		 * doodle layer.
		 */
		const scatterDoodles =
			setupDoodles();


		const blocks =
			setupBlocks(zone);


		/*
		 * Every valid empty-paper click causes BOTH:
		 *
		 * 1. doodles to move across the entire page
		 * 2. content blocks to shuffle
		 */
		const reshuffle = () => {

			if (blocks) {
				blocks.shuffle();
			}

			scatterDoodles();
		};


		/* -----------------------------------------------------
		   DETERMINE WHETHER CLICK IS ON PAPER
		   ----------------------------------------------------- */

		function isShuffleSpot(target) {

			/*
			 * If the target isn't an Element,
			 * treat it as paper.
			 */
			if (!(target instanceof Element)) {
				return true;
			}


			/*
			 * Don't shuffle when clicking actual
			 * interactive/content elements.
			 *
			 * Everything else is considered paper.
			 */
			return !target.closest(
				'a, button, input, textarea, ' +
				'select, option, video, audio, iframe, ' +
				'.polaroid, [data-shuffle], ' +
				'.route-stage, .route-zone'
			);
		}


		/* -----------------------------------------------------
		   MOUSE / TRACKPAD
		   ----------------------------------------------------- */

		let lastTapShuffle = 0;


		document.addEventListener(
			'click',
			(event) => {

				/*
				 * Mobile browsers fire a synthetic click
				 * after touchend. Ignore it because the
				 * touch handler already shuffled.
				 */
				if (
					Date.now() -
						lastTapShuffle <
					GHOST_CLICK_MS
				) {
					return;
				}


				if (
					isShuffleSpot(
						event.target
					)
				) {
					reshuffle();
				}
			}
		);


		/* -----------------------------------------------------
		   TOUCH
		   ----------------------------------------------------- */

		let touch = null;


		document.addEventListener(
			'touchstart',
			(event) => {

				if (
					event.touches.length !==
					1
				) {
					touch = null;
					return;
				}


				const point =
					event.touches[0];


				touch = {
					x:
						point.clientX,

					y:
						point.clientY,

					time:
						Date.now(),

					target:
						event.target
				};
			},
			{ passive: true }
		);


		document.addEventListener(
			'touchmove',
			(event) => {

				if (!touch) {
					return;
				}


				const point =
					event.touches[0];


				/*
				 * If the finger moved, this is
				 * scrolling rather than tapping.
				 */
				if (
					Math.hypot(
						point.clientX -
							touch.x,

						point.clientY -
							touch.y
					) >
					TAP_MAX_MOVE
				) {
					touch = null;
				}
			},
			{ passive: true }
		);


		document.addEventListener(
			'touchend',
			() => {

				if (
					touch &&
					Date.now() -
						touch.time <
						TAP_MAX_MS &&
					isShuffleSpot(
						touch.target
					)
				) {

					lastTapShuffle =
						Date.now();

					reshuffle();
				}


				touch = null;
			},
			{ passive: true }
		);


		document.addEventListener(
			'touchcancel',
			() => {
				touch = null;
			},
			{ passive: true }
		);


		/* -----------------------------------------------------
		   RESIZE
		   ----------------------------------------------------- */

		let lastWidth =
			window.innerWidth;

		let resizeTimer;


		window.addEventListener(
			'resize',
			() => {

				/*
				 * Ignore mobile browser toolbar height
				 * changes. Only react to width changes.
				 */
				if (
					window.innerWidth ===
					lastWidth
				) {
					return;
				}


				lastWidth =
					window.innerWidth;


				clearTimeout(
					resizeTimer
				);


				resizeTimer =
					setTimeout(() => {

						scatterDoodles();


						if (
							blocks &&
							blocks.isShuffled()
						) {
							blocks.shuffle();
						}

					}, 250);
			}
		);
	}


	/* 3. POLAROIDS --------------------------------------------------------- */

	function initPolaroids() {

		document
			.querySelectorAll('.polaroid')
			.forEach((card) => {

				/*
				 * Random tilt between 1.5° and 6°
				 * unless one is already specified inline.
				 */
				if (
					!card.style.getPropertyValue(
						'--rot'
					)
				) {

					const sign =
						Math.random() <
						0.5
							? -1
							: 1;


					card.style.setProperty(
						'--rot',
						`${(
							sign *
							rand(1.5, 6)
						).toFixed(1)}deg`
					);
				}


				const lift = () =>
					card.classList.add(
						'is-lifted'
					);


				const drop = () =>
					card.classList.remove(
						'is-lifted'
					);


				card.addEventListener(
					'mouseenter',
					lift
				);


				card.addEventListener(
					'mouseleave',
					drop
				);


				card.addEventListener(
					'focus',
					lift
				);


				card.addEventListener(
					'blur',
					drop
				);


				/*
				 * Touch screens have no hover,
				 * so tapping toggles the popup.
				 */
				card.addEventListener(
					'pointerup',
					(event) => {

						if (
							event.pointerType ===
							'touch'
						) {
							card.classList.toggle(
								'is-lifted'
							);
						}
					}
				);
			});
	}


	/* 4. LINE-DRAW ANIMATION ----------------------------------------------- */

	const DRAWABLE =
		'path, line, polyline, polygon, rect, circle, ellipse';


	function initDrawOn() {

		const groups =
			[
				...document.querySelectorAll(
					'[data-draw]'
				)
			];


		if (!groups.length) {
			return;
		}


		/*
		 * Measure each stroke so CSS can hide it
		 * using stroke-dasharray / stroke-dashoffset.
		 */
		groups.forEach((group) => {

			group
				.querySelectorAll(DRAWABLE)
				.forEach((shape, i) => {

					/*
					 * Some SVG shapes may not support
					 * getTotalLength(). Guard against that.
					 */
					if (
						typeof shape.getTotalLength ===
						'function'
					) {

						shape.style.setProperty(
							'--len',
							`${shape
								.getTotalLength()
								.toFixed(1)}px`
						);
					}


					shape.style.setProperty(
						'--i',
						i
					);
				});


			group.classList.add(
				'draw-ready'
			);
		});


		const draw = (group) =>
			group.classList.add(
				'is-drawn'
			);


		if (
			reducedMotion ||
			!(
				'IntersectionObserver'
				in window
			)
		) {

			groups.forEach(draw);

			return;
		}


		/*
		 * Observe the outer SVG of each group.
		 */
		const groupsBySvg =
			new Map();


		groups.forEach((group) => {

			const svg =
				group.ownerSVGElement ||
				group;


			if (
				!groupsBySvg.has(svg)
			) {
				groupsBySvg.set(
					svg,
					[]
				);
			}


			groupsBySvg
				.get(svg)
				.push(group);
		});


		const observer =
			new IntersectionObserver(
				(entries) => {

					entries.forEach(
						(entry) => {

							if (
								!entry.isIntersecting
							) {
								return;
							}


							/*
							 * Double requestAnimationFrame
							 * lets the hidden state paint before
							 * the transition begins.
							 */
							requestAnimationFrame(
								() =>
									requestAnimationFrame(
										() => {

											groupsBySvg
												.get(
													entry.target
												)
												.forEach(
													draw
												);
										}
									)
							);


							observer.unobserve(
								entry.target
							);
						}
					);
				},
				{
					threshold: 0.3
				}
			);


		groupsBySvg.forEach(
			(_, svg) =>
				observer.observe(svg)
		);
	}


	/* 5. CHANDIGARH ⇄ PATIALA FLIGHT --------------------------------------- */

	const FLIGHT_MS = 1800;


	function initFlight() {

		const stage =
			document.querySelector(
				'.route-stage'
			);


		if (!stage) {
			return;
		}


		const path =
			stage.querySelector(
				'#flight-path'
			);


		const plane =
			stage.querySelector(
				'#plane'
			);


		const zones =
			stage.querySelectorAll(
				'.route-zone'
			);


		if (!path || !plane) {
			return;
		}


		const totalLength =
			path.getTotalLength();


		let progress = 0;
		let currentTarget = null;
		let rafId = null;
		let hopTimer = null;


		const easeInOut = (t) =>
			t < 0.5
				? 4 * t * t * t
				: 1 -
					Math.pow(
						-2 * t + 2,
						3
					) /
					2;


		/*
		 * Put the plane at p along the path,
		 * with its nose pointing in the
		 * direction of travel.
		 */
		function placePlane(
			p,
			heading
		) {

			const at =
				p * totalLength;


			const point =
				path.getPointAtLength(at);


			const behind =
				path.getPointAtLength(
					Math.max(
						0,
						at - 1
					)
				);


			const ahead =
				path.getPointAtLength(
					Math.min(
						totalLength,
						at + 1
					)
				);


			let angle =
				(
					Math.atan2(
						ahead.y -
							behind.y,
						ahead.x -
							behind.x
					) *
					180
				) /
				Math.PI;


			if (heading < 0) {
				angle += 180;
			}


			plane.setAttribute(
				'transform',
				`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) ` +
				`rotate(${angle.toFixed(1)})`
			);
		}


		function animateTo(target) {

			cancelAnimationFrame(
				rafId
			);


			const start =
				progress;


			const heading =
				Math.sign(
					target - start
				) || 1;


			const duration =
				reducedMotion
					? 0
					: FLIGHT_MS *
						Math.abs(
							target - start
						);


			const startTime =
				performance.now();


			currentTarget =
				target;


			stage.classList.add(
				'is-flying'
			);


			const step = (now) => {

				const t =
					duration
						? Math.min(
							1,
							(now -
								startTime) /
								duration
						)
						: 1;


				progress =
					start +
					(target - start) *
						easeInOut(t);


				placePlane(
					progress,
					heading
				);


				if (t < 1) {

					rafId =
						requestAnimationFrame(
							step
						);

				} else {

					rafId = null;
					currentTarget = null;

					stage.classList.remove(
						'is-flying'
					);
				}
			};


			rafId =
				requestAnimationFrame(
					step
				);
		}


		/*
		 * target:
		 *
		 * 1 = fly to Patiala
		 * 0 = fly to Chandigarh
		 */
		function fly(target) {

			if (
				currentTarget ===
				target
			) {
				return;
			}


			/*
			 * Cancel pending hop if the other
			 * zone is triggered.
			 */
			if (hopTimer) {

				clearTimeout(
					hopTimer
				);

				hopTimer = null;

				plane.classList.remove(
					'is-hidden'
				);
			}


			const parkedAtDestination =
				rafId === null &&
				Math.abs(
					progress - target
				) < 0.001;


			if (!parkedAtDestination) {

				animateTo(target);

				return;
			}


			/*
			 * Plane is already at the destination:
			 *
			 * fade out → appear at origin → fly again.
			 */
			const origin =
				1 - target;


			plane.classList.add(
				'is-hidden'
			);


			hopTimer =
				setTimeout(
					() => {

						hopTimer = null;

						progress =
							origin;


						placePlane(
							progress,
							target - origin
						);


						plane.classList.remove(
							'is-hidden'
						);


						animateTo(
							target
						);

					},
					reducedMotion
						? 0
						: 220
				);
		}


		/*
		 * Start parked at Chandigarh.
		 */
		placePlane(0, 1);


		zones.forEach((zone) => {

			const trigger = () =>
				fly(
					Number(
						zone.dataset.target
					)
				);


			zone.addEventListener(
				'pointerenter',
				trigger
			);


			zone.addEventListener(
				'focus',
				trigger
			);


			zone.addEventListener(
				'click',
				trigger
			);
		});
	}


	/* 6. SOCIAL LINKS ------------------------------------------------------ */

	function initSocials() {

		const items =
			document.querySelectorAll(
				'.social-item'
			);


		const reveal = (item) =>
			item.classList.add(
				'animated',
				'fadeInUp'
			);


		if (
			!(
				'IntersectionObserver'
				in window
			)
		) {

			items.forEach(reveal);

			return;
		}


		const observer =
			new IntersectionObserver(
				(entries) => {

					entries.forEach(
						(entry) => {

							if (
								!entry.isIntersecting
							) {
								return;
							}


							reveal(
								entry.target
							);


							observer.unobserve(
								entry.target
							);
						}
					);
				},
				{
					threshold: 0.2
				}
			);


		items.forEach(
			(item) =>
				observer.observe(item)
		);
	}


	/* 7. AUDIO -------------------------------------------------------------
	   Two separate things that share one rule: browsers only let a page make
	   noise after the visitor has interacted with it. Safari (WebKit) is much
	   stricter than Chrome about what counts, so the notes below say why each
	   piece is shaped the way it is.

	   - The click sound is a pool of <audio> copies. WebKit will not even load
	     media until a gesture asks for it, grants playback per element, and
	     throws if you seek a clip that has no data yet — so every play() call
	     stays synchronous inside the gesture, and the seek is guarded.
	   - Background music lives in the hidden #bg-music YouTube embed. It
	     autoplays muted and the floating button un-mutes it through the
	     YouTube IFrame Player API. Safari does NOT propagate user activation
	     into cross-origin iframes, so the un-mute can be refused inside the
	     embed even though our click was perfectly real. We therefore verify
	     afterwards and tell the truth in the UI rather than showing "playing"
	     over silence.

	   Add ?audiodebug=1 to the URL to log every step (and show it on screen,
	   for phones that have no console to open).
	   ---------------------------------------------------------------------- */

	function initAudio() {

		const frame =
			document.getElementById(
				'bg-music'
			);

		const button =
			document.getElementById(
				'music-toggle'
			);

		const label =
			document.getElementById(
				'music-toggle-label'
			);


		/* -----------------------------------------------------
		   DEBUG LOG  (?audiodebug=1)
		   ----------------------------------------------------- */

		const debugOn =
			/[?&]audiodebug=1\b/.test(
				window.location.search
			);

		let debugPanel = null;


		function logAudio(message, detail) {

			if (!debugOn) {
				return;
			}


			const text =
				detail === undefined
					? message
					: message + ' — ' + detail;


			window.console.log(
				'[audio]',
				message,
				detail === undefined
					? ''
					: detail
			);


			if (!debugPanel) {

				debugPanel =
					document.createElement('div');

				debugPanel.className =
					'audio-debug';

				document.body.appendChild(
					debugPanel
				);
			}


			const line =
				document.createElement('p');

			line.textContent = text;

			debugPanel.appendChild(line);


			/* keep the panel short enough to read */
			while (debugPanel.children.length > 14) {

				debugPanel.removeChild(
					debugPanel.firstChild
				);
			}
		}


		function describeError(error) {

			if (!error) {
				return 'unknown error';
			}


			return (
				(error.name || 'Error') +
				': ' +
				(error.message || String(error))
			);
		}


		/* =====================================================
		   CLICK SOUND
		   =====================================================
		   Set up first, so a missing/blocked YouTube embed can
		   never take the click sound down with it. */

		const source =
			document.getElementById(
				'click-sfx'
			);


		const POOL_SIZE = 5;

		const pool = [];

		let poolIndex = 0;

		let poolPrimed = false;


		if (source) {

			for (
				let i = 0;
				i < POOL_SIZE;
				i += 1
			) {

				const clip =
					new Audio(
						source.getAttribute('src')
					);

				/*
				 * iOS ignores volume entirely (it is
				 * read-only there and the hardware
				 * buttons own it), so the clip itself
				 * needs to be quiet on disk.
				 */
				clip.volume = 0.25;

				clip.preload = 'auto';

				pool.push(clip);
			}
		}


		/*
		 * WebKit refuses to fetch media that no gesture has
		 * asked for, so clips 2..5 can still be empty when
		 * their turn comes round. On the first gesture we call
		 * load() on them — allowed here because we are inside
		 * that gesture — and clip 1 gets primed simply by
		 * being the one that plays for this very click.
		 */
		function primePool() {

			if (poolPrimed) {
				return;
			}


			poolPrimed = true;


			pool.forEach((clip) => {

				if (clip.readyState > 0) {
					return;
				}


				try {
					clip.load();
				} catch (error) {
					logAudio(
						'pool load failed',
						describeError(error)
					);
				}
			});
		}


		function playClick() {

			if (!pool.length) {
				return;
			}


			const clip =
				pool[poolIndex];

			poolIndex =
				(poolIndex + 1) % pool.length;


			/*
			 * Safari throws InvalidStateError when you seek
			 * a clip whose readyState is still HAVE_NOTHING,
			 * and that would abort the handler before play()
			 * ever ran — which is exactly why this worked in
			 * Chrome and did nothing in Safari. So the seek
			 * gets its own guard and its own try/catch, and
			 * play() happens no matter what it does.
			 */
			if (clip.readyState > 0) {

				try {
					clip.currentTime = 0;
				} catch (error) {
					logAudio(
						'seek refused',
						describeError(error)
					);
				}
			}


			/*
			 * Nothing async may sit between the gesture and
			 * this call, or WebKit stops treating it as
			 * user-initiated.
			 */
			try {

				const played =
					clip.play();


				if (
					played &&
					typeof played.catch ===
						'function'
				) {

					played.catch((error) => {
						logAudio(
							'click sound blocked',
							describeError(error)
						);
					});
				}

			} catch (error) {

				logAudio(
					'click sound threw',
					describeError(error)
				);
			}
		}


		/* -----------------------------------------------------
		   UNLOCK: first interaction of the session
		   -----------------------------------------------------
		   Nudges the muted embed into playing, so that when the
		   visitor does hit the button there is already a running
		   video to un-mute. */

		let unlocked = false;

		let wantsPlay = false;


		function unlockAudio() {

			if (unlocked) {
				return;
			}


			unlocked = true;

			logAudio('audio unlocked by first gesture');


			if (playerReady && player) {
				player.playVideo();
			} else {
				wantsPlay = true;
			}
		}


		/* -----------------------------------------------------
		   WHAT COUNTS AS A CLICK
		   -----------------------------------------------------
		   iOS Safari only bubbles `click` up to the document
		   from elements it already considers clickable, so taps
		   on empty paper never reached a document-level click
		   listener. pointerdown covers mouse and touch alike,
		   is a trusted gesture in WebKit, and fires a touch
		   earlier so the pop feels immediate. */

		function onGesture() {

			playClick();

			primePool();

			unlockAudio();
		}


		if (window.PointerEvent) {

			document.addEventListener(
				'pointerdown',
				onGesture,
				{ capture: true }
			);

		} else {

			document.addEventListener(
				'mousedown',
				onGesture,
				{ capture: true }
			);

			document.addEventListener(
				'touchstart',
				onGesture,
				{ capture: true, passive: true }
			);
		}


		/* =====================================================
		   BACKGROUND MUSIC
		   ===================================================== */

		let player = null;

		let playerReady = false;

		let musicOn = false;

		/* a click that arrived before the API had loaded */
		let wantsMusicOn = false;

		/* 'idle' | 'waiting' | 'blocked' */
		let musicNote = 'idle';

		let verifyTimer = 0;


		function paintButton() {

			if (!button) {
				return;
			}


			button.setAttribute(
				'aria-pressed',
				musicOn
					? 'true'
					: 'false'
			);


			button.setAttribute(
				'aria-label',
				musicOn
					? 'Turn background music off'
					: 'Turn background music on'
			);


			const icon =
				button.querySelector('i');


			if (icon) {

				icon.className =
					musicOn
						? 'fa-solid fa-music'
						: 'fa-solid fa-volume-xmark';
			}


			button.classList.toggle(
				'is-waiting',
				musicNote === 'waiting'
			);


			if (label) {

				if (musicNote === 'waiting') {

					label.textContent = 'loading…';

				} else if (musicNote === 'blocked') {

					/*
					 * Safari refused the un-mute. Say so
					 * instead of claiming to be playing:
					 * one more click, now that the player
					 * is ready, usually lands.
					 */
					label.textContent = 'tap again';

				} else {

					label.textContent =
						musicOn
							? 'playing'
							: 'play';
				}
			}
		}


		/*
		 * The embed is cross-origin, so every call below is
		 * really a postMessage: it can be quietly refused
		 * inside the iframe. A moment later we ask the player
		 * what actually happened and correct the UI.
		 */
		function verifyMusic(expectOn) {

			window.clearTimeout(verifyTimer);


			verifyTimer =
				window.setTimeout(() => {

					if (!player || !playerReady) {
						return;
					}


					let muted = true;

					let state = -1;


					try {

						muted =
							player.isMuted();

						state =
							player.getPlayerState();

					} catch (error) {

						logAudio(
							'player query failed',
							describeError(error)
						);

						return;
					}


					const playing =
						state ===
							window.YT.PlayerState.PLAYING ||
						state ===
							window.YT.PlayerState.BUFFERING;


					logAudio(
						'after toggle',
						'muted=' + muted +
							' state=' + state
					);


					if (!expectOn) {
						return;
					}


					if (muted || !playing) {

						/*
						 * Safari does not hand user
						 * activation to a cross-origin
						 * iframe, so the un-mute (or the
						 * play) can be dropped even
						 * though the click was real.
						 */
						logAudio(
							'un-mute refused by the browser'
						);

						musicOn = false;

						musicNote = 'blocked';

						paintButton();

					} else if (musicNote !== 'idle') {

						musicNote = 'idle';

						paintButton();
					}
				}, 700);
		}


		/*
		 * Must be called straight from the click handler —
		 * no awaiting, no timers in front of it — so the
		 * gesture is still live when the postMessage goes out.
		 */
		function applyMusic(on) {

			try {

				if (on) {

					player.unMute();

					player.setVolume(35);

					player.playVideo();

				} else {

					player.mute();

					player.pauseVideo();
				}

			} catch (error) {

				logAudio(
					'player command failed',
					describeError(error)
				);
			}


			verifyMusic(on);
		}


		function toggleMusic() {

			if (!playerReady || !player) {

				/*
				 * The API has not finished loading. Queue
				 * the intent AND show it, so the button
				 * never looks dead — Safari is regularly
				 * slow enough here for that to be visible.
				 */
				wantsMusicOn = !wantsMusicOn;

				wantsPlay = true;

				musicNote =
					wantsMusicOn
						? 'waiting'
						: 'idle';

				logAudio(
					'clicked before the player was ready',
					'queued=' + wantsMusicOn
				);

				paintButton();

				return;
			}


			musicOn = !musicOn;

			musicNote = 'idle';

			applyMusic(musicOn);

			paintButton();
		}


		if (button) {

			button.addEventListener(
				'click',
				toggleMusic
			);
		}


		/* -----------------------------------------------------
		   WHICH VIDEO
		   -----------------------------------------------------
		   Read straight out of the iframe's own src, so the id
		   lives in exactly one place. Nothing here may ever
		   carry a second, literal id — that is how an embed
		   ends up playing something nobody asked for. */

		function expectedVideoId() {

			if (!frame) {
				return '';
			}


			const match =
				/\/embed\/([A-Za-z0-9_-]{11})/.exec(
					frame.getAttribute('src') || ''
				);


			return match
				? match[1]
				: '';
		}


		/* what the player says it is actually playing */
		function currentVideoId() {

			if (!player || !playerReady) {
				return '';
			}


			try {

				const data =
					typeof player.getVideoData ===
						'function'
						? player.getVideoData()
						: null;


				return (
					data &&
					data.video_id
				)
					? data.video_id
					: '';

			} catch (error) {

				logAudio(
					'could not read video data',
					describeError(error)
				);

				return '';
			}
		}


		/*
		 * If the player has drifted onto another video — a
		 * suggested/related one after the loop fails to catch,
		 * which is the one way this embed can change track —
		 * put it back on the one the src asked for.
		 */
		function keepOnTrack() {

			const wanted =
				expectedVideoId();

			const playing =
				currentVideoId();


			if (
				!wanted ||
				!playing ||
				playing === wanted
			) {
				return false;
			}


			logAudio(
				'WRONG VIDEO',
				'playing ' + playing +
					', expected ' + wanted +
					' — reloading'
			);


			try {

				player.loadVideoById(wanted);


				if (!musicOn) {
					player.mute();
				}

			} catch (error) {

				logAudio(
					'reload failed',
					describeError(error)
				);
			}


			return true;
		}


		/* -----------------------------------------------------
		   YOUTUBE IFRAME PLAYER API
		   ----------------------------------------------------- */

		if (!frame) {
			return;
		}


		paintButton();


		window.onYouTubeIframeAPIReady = () => {

			logAudio('YouTube API script ready');


			player =
				new window.YT.Player(
					'bg-music',
					{
						events: {

							onReady: () => {

								playerReady = true;

								logAudio(
									'player ready',
									'expected ' +
										expectedVideoId() +
										', loaded ' +
										(currentVideoId() ||
											'unknown')
								);


								/*
								 * Keep it muted and looping
								 * until the visitor asks for
								 * sound.
								 */
								try {
									player.mute();
								} catch (error) {
									logAudio(
										'mute failed',
										describeError(error)
									);
								}


								if (
									wantsPlay ||
									wantsMusicOn
								) {
									player.playVideo();
								}


								if (wantsMusicOn) {

									wantsMusicOn = false;

									musicOn = true;


									/*
									 * This un-mute is running
									 * from an API callback, not
									 * from the click itself, so
									 * the gesture is long gone.
									 * Chrome usually allows it;
									 * Safari usually will not —
									 * verifyMusic() will catch
									 * that and ask for one more
									 * tap.
									 */
									applyMusic(true);

									paintButton();

								} else if (musicNote === 'waiting') {

									musicNote = 'idle';

									paintButton();
								}
							},


							onError: (event) => {

								logAudio(
									'player error',
									'code ' + event.data
								);
							},


							/*
							 * loop=1 + playlist= normally
							 * handles the repeat; this is
							 * the belt-and-braces version
							 * for browsers where it drops
							 * out after one pass.
							 */
							onStateChange: (event) => {

								logAudio(
									'state',
									event.data +
										' · video ' +
										(currentVideoId() ||
											'unknown')
								);


								/*
								 * Any state change is a chance
								 * to notice the player has been
								 * moved onto another video.
								 */
								if (keepOnTrack()) {
									return;
								}


								if (
									event.data ===
									window.YT.PlayerState.ENDED
								) {

									/*
									 * Rewind rather than calling
									 * playVideo() blind: by the
									 * time ENDED lands, YouTube
									 * may already have queued a
									 * suggested video, and a
									 * bare playVideo() would
									 * happily start THAT.
									 */
									try {
										player.seekTo(0, true);
									} catch (error) {
										logAudio(
											'rewind failed',
											describeError(error)
										);
									}


									player.playVideo();
								}
							}
						}
					}
				);
		};


		/*
		 * If the API never arrives (an extension, a blocker or
		 * Safari's tracking prevention can all stop it), say so
		 * rather than leaving a button that does nothing.
		 */
		window.setTimeout(() => {

			if (!playerReady) {

				logAudio(
					'YouTube API still not ready after 8s'
				);


				if (musicNote === 'waiting') {

					musicNote = 'blocked';

					paintButton();
				}
			}
		}, 8000);


		const api =
			document.createElement('script');

		api.src =
			'https://www.youtube.com/iframe_api';

		api.onerror = () => {
			logAudio('YouTube API script failed to load');
		};

		document.head.appendChild(api);
	}


	/* GO ------------------------------------------------------------------- */

	initDate();
	initShuffle();
	initPolaroids();
	initDrawOn();
	initFlight();
	initSocials();
	initAudio();

})();