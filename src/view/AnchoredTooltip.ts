/**
 * One anchored tooltip layer per open Quick Capture view, replacing native `title` attributes
 * (which render detached/unpositionable, see design_change/quick-capture-design-improvements.md
 * #3) and the risk of a form control hosting a CSS-only pseudo-element tooltip.
 *
 * Targets opt in with `data-qc-tooltip="<text>"` (set via `setQuickCaptureTooltip`). A single
 * delegated listener set on the view root handles every current and future target -- footer
 * rerenders (which happen constantly in this view) never leak listeners or accumulate
 * controllers, since nothing is bound to the target elements themselves.
 */

export interface TooltipController {
	attach(root: HTMLElement): void;
	destroy(): void;
}

/** data attribute read by the delegated listeners below; the attribute value is the tooltip's
 *  visible text. Never interpolated as HTML -- always assigned via text APIs. */
const TOOLTIP_ATTR = "data-qc-tooltip";

const TOOLTIP_GAP = 6; // px between trigger and tooltip box
const TOOLTIP_EDGE_PADDING = 8; // px keep-out margin from the anchored root's own edges
const ARROW_EDGE_INSET = 10; // px min distance from the tooltip box's corner to the arrow

let controllerSequence = 0;

/** Attach a tooltip to `target`, shown by the nearest ancestor `AnchoredTooltipController`. */
export function setQuickCaptureTooltip(target: HTMLElement, text: string): void {
	target.setAttribute(TOOLTIP_ATTR, text);
}

export class AnchoredTooltipController implements TooltipController {
	private root: HTMLElement | null = null;
	private tooltipEl: HTMLElement | null = null;
	private textEl: HTMLElement | null = null;
	private arrowEl: HTMLElement | null = null;
	private activeTarget: HTMLElement | null = null;
	private mutationObserver: MutationObserver | null = null;
	private readonly tooltipId = `ai-quickcap-tooltip-${++controllerSequence}`;

	private readonly onPointerOver = (evt: PointerEvent): void => this.handleEnter(evt.target);
	private readonly onPointerOut = (evt: PointerEvent): void => this.handleLeave(evt.target, evt.relatedTarget);
	private readonly onFocusIn = (evt: FocusEvent): void => this.handleEnter(evt.target);
	private readonly onFocusOut = (evt: FocusEvent): void => this.handleLeave(evt.target, evt.relatedTarget);
	private readonly onKeyDown = (evt: KeyboardEvent): void => {
		// Deliberately no preventDefault/stopPropagation: other Escape handlers (e.g. the note
		// picker's own close-on-Escape) must still run independently of tooltip visibility.
		if (evt.key === "Escape" && this.activeTarget) this.hide();
	};
	private readonly onScroll = (): void => {
		if (this.activeTarget) this.reposition();
	};
	private readonly onResize = (): void => {
		if (this.activeTarget) this.reposition();
	};

	attach(root: HTMLElement): void {
		this.root = root;

		const tooltipEl = root.createDiv({ cls: "ai-quickcap-tooltip" });
		tooltipEl.setAttribute("role", "tooltip");
		tooltipEl.id = this.tooltipId;
		tooltipEl.setCssStyles({ visibility: "hidden" });
		this.textEl = tooltipEl.createSpan({ cls: "ai-quickcap-tooltip-text" });
		this.arrowEl = tooltipEl.createDiv({ cls: "ai-quickcap-tooltip-arrow" });
		this.tooltipEl = tooltipEl;

		// pointerover/pointerout and focusin/focusout bubble (unlike pointerenter/pointerleave and
		// focus/blur), which is what makes event delegation from one root listener possible.
		root.addEventListener("pointerover", this.onPointerOver);
		root.addEventListener("pointerout", this.onPointerOut);
		root.addEventListener("focusin", this.onFocusIn);
		root.addEventListener("focusout", this.onFocusOut);
		root.addEventListener("keydown", this.onKeyDown);
		// capture:true so a scroll inside any nested scrollable region (sidebar, picker results)
		// is still observed here -- the native "scroll" event does not bubble.
		window.addEventListener("scroll", this.onScroll, true);
		window.addEventListener("resize", this.onResize);

		// Passive backstop for "target removed during footer rerender while tooltip is visible":
		// explicit `hide()` calls at the view's main render entry points are the primary,
		// synchronous mechanism (see QuickCaptureView.render()/renderFooter()); this observer
		// only catches whatever those call sites miss, without needing to chase every `.empty()`
		// call across the view.
		this.mutationObserver = new MutationObserver(() => {
			if (this.activeTarget && !this.activeTarget.isConnected) this.hide();
		});
		this.mutationObserver.observe(root, { childList: true, subtree: true });
	}

	destroy(): void {
		if (this.root) {
			this.root.removeEventListener("pointerover", this.onPointerOver);
			this.root.removeEventListener("pointerout", this.onPointerOut);
			this.root.removeEventListener("focusin", this.onFocusIn);
			this.root.removeEventListener("focusout", this.onFocusOut);
			this.root.removeEventListener("keydown", this.onKeyDown);
		}
		window.removeEventListener("scroll", this.onScroll, true);
		window.removeEventListener("resize", this.onResize);
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
		this.tooltipEl?.remove();
		this.tooltipEl = null;
		this.textEl = null;
		this.arrowEl = null;
		this.activeTarget = null;
		this.root = null;
	}

	/** Immediately hides the tooltip if one is showing. Safe to call unconditionally (e.g. at
	 *  the top of a render pass) -- a no-op when nothing is active. */
	hide(): void {
		if (!this.activeTarget) return;
		this.activeTarget.removeAttribute("aria-describedby");
		this.activeTarget = null;
		if (this.tooltipEl) this.tooltipEl.setCssStyles({ visibility: "hidden" });
	}

	private handleEnter(eventTarget: EventTarget | null): void {
		const target = this.closestTooltipTarget(eventTarget);
		if (!target || target === this.activeTarget) return;
		this.show(target);
	}

	private handleLeave(eventTarget: EventTarget | null, related: EventTarget | null): void {
		const target = this.closestTooltipTarget(eventTarget);
		if (!target || target !== this.activeTarget) return;
		// Moving from the target to one of its own descendants (e.g. an inner label span) is not
		// actually leaving it.
		if (related instanceof Node && target.contains(related)) return;
		this.hide();
	}

	private closestTooltipTarget(eventTarget: EventTarget | null): HTMLElement | null {
		if (!(eventTarget instanceof Element)) return null;
		const el = eventTarget.closest(`[${TOOLTIP_ATTR}]`);
		return el instanceof HTMLElement ? el : null;
	}

	private show(target: HTMLElement): void {
		const text = target.getAttribute(TOOLTIP_ATTR);
		if (!this.tooltipEl || !this.textEl || !text) return;
		this.activeTarget = target;
		this.textEl.setText(text);
		target.setAttribute("aria-describedby", this.tooltipId);
		this.reposition();
	}

	private reposition(): void {
		if (!this.root || !this.tooltipEl || !this.arrowEl || !this.activeTarget) return;
		if (!this.activeTarget.isConnected) {
			this.hide();
			return;
		}

		const targetRect = this.activeTarget.getBoundingClientRect();
		const rootRect = this.root.getBoundingClientRect();

		// Scrolled (or resized) fully outside the view's own bounds -- fail closed rather than
		// anchoring to a position that no longer makes sense (never place at (0,0) or a stale
		// viewport edge).
		const fullyOutside =
			targetRect.bottom <= rootRect.top ||
			targetRect.top >= rootRect.bottom ||
			targetRect.right <= rootRect.left ||
			targetRect.left >= rootRect.right;
		if (fullyOutside) {
			this.hide();
			return;
		}

		// Measure with visibility:hidden (not display:none) so layout is real but nothing flashes.
		this.tooltipEl.setCssStyles({ visibility: "hidden" });
		const tooltipRect = this.tooltipEl.getBoundingClientRect();
		const w = tooltipRect.width;
		const h = tooltipRect.height;

		let placement: "top" | "bottom" = "top";
		let top = targetRect.top - h - TOOLTIP_GAP;
		if (top < rootRect.top + TOOLTIP_EDGE_PADDING) {
			placement = "bottom";
			top = targetRect.bottom + TOOLTIP_GAP;
		}

		let left = targetRect.left + targetRect.width / 2 - w / 2;
		const minLeft = rootRect.left + TOOLTIP_EDGE_PADDING;
		const maxLeft = rootRect.right - w - TOOLTIP_EDGE_PADDING;
		left = Math.min(Math.max(left, minLeft), maxLeft);

		const targetCenterX = targetRect.left + targetRect.width / 2;
		const arrowLeft = Math.min(Math.max(targetCenterX - left, ARROW_EDGE_INSET), Math.max(w - ARROW_EDGE_INSET, ARROW_EDGE_INSET));

		this.tooltipEl.setCssStyles({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
		this.tooltipEl.setAttribute("data-placement", placement);
		this.arrowEl.setCssStyles({ left: `${Math.round(arrowLeft)}px` });
		this.tooltipEl.setCssStyles({ visibility: "visible" });
	}
}
