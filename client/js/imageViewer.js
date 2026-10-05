/**
 * Spendly Full-Size Profile Picture Lightbox Viewer
 * Provides a modern, responsive full-screen image viewer with fallback states,
 * aspect ratio preservation, loading indicator, keyboard navigation, and backdrop dismissal.
 */
const SpendlyImageViewer = {
  activeOverlay: null,
  keyHandler: null,

  /**
   * Open the full-size image viewer
   * @param {Object} options
   * @param {string} options.src - URL of the full-size image
   * @param {string} options.name - Display name of the user
   * @param {string} options.fallbackInitials - Fallback initials letter
   */
  open({ src, name = 'User', fallbackInitials = 'U' }) {
    this.close(); // Close any currently open instance

    const overlay = document.createElement('div');
    overlay.className = 'spendly-image-viewer-overlay';
    overlay.id = 'spendly-image-viewer';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${name}'s Profile Photo`);

    overlay.innerHTML = `
      <div class="image-viewer-backdrop"></div>
      <button class="image-viewer-close-btn" aria-label="Close image viewer" title="Close (Esc)">&times;</button>
      <div class="image-viewer-dialog">
        <div class="image-viewer-spinner" id="image-viewer-loader">
          <div class="viewer-spinner-ring"></div>
        </div>
        <img class="image-viewer-photo" id="image-viewer-img" alt="${this.escapeHtml(name)}'s Profile Photo" style="display: none;" />
        <div class="image-viewer-fallback-card" id="image-viewer-fallback" style="display: none;">
          <div class="image-viewer-fallback-circle">
            ${this.escapeHtml(fallbackInitials[0] ? fallbackInitials[0].toUpperCase() : 'U')}
          </div>
          <div class="image-viewer-fallback-text">No custom profile photo set</div>
        </div>
        <div class="image-viewer-meta">
          <span class="image-viewer-username">${this.escapeHtml(name)}</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.activeOverlay = overlay;

    // Prevent background scrolling
    document.body.style.overflow = 'hidden';

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
    });

    const img = overlay.querySelector('#image-viewer-img');
    const loader = overlay.querySelector('#image-viewer-loader');
    const fallback = overlay.querySelector('#image-viewer-fallback');
    const closeBtn = overlay.querySelector('.image-viewer-close-btn');
    const backdrop = overlay.querySelector('.image-viewer-backdrop');

    const showFallback = () => {
      if (loader) loader.style.display = 'none';
      if (img) img.style.display = 'none';
      if (fallback) fallback.style.display = 'flex';
    };

    if (src && src.trim() && src !== 'null' && src !== 'undefined') {
      img.onload = () => {
        if (loader) loader.style.display = 'none';
        if (img) img.style.display = 'block';
        if (fallback) fallback.style.display = 'none';
      };
      img.onerror = () => {
        showFallback();
      };
      img.src = src;
    } else {
      showFallback();
    }

    // Dismiss events
    closeBtn.onclick = () => this.close();
    backdrop.onclick = () => this.close();

    // Escape key listener
    this.keyHandler = (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  },

  /**
   * Close the active viewer
   */
  close() {
    if (!this.activeOverlay) return;

    const overlay = this.activeOverlay;
    overlay.classList.remove('is-open');

    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }

    setTimeout(() => {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      document.body.style.overflow = '';
      this.activeOverlay = null;
    }, 200);
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

window.SpendlyImageViewer = SpendlyImageViewer;
