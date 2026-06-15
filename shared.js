/**
 * GIF Nyanpasu! — shared.js
 *
 * Utility functions used across all pages.
 * Must be loaded before any page-specific script.
 */

'use strict';

/**
 * Format a duration in seconds as M:SS.ss
 * @param {number} s - seconds
 * @returns {string}
 */
function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}

/**
 * Format a byte count as a human-readable KB / MB string.
 * @param {number} bytes
 * @returns {string}
 */
function fmtBytes(bytes) {
    const kb = bytes / 1024;
    return kb >= 1024
        ? `${(kb / 1024).toFixed(2)} MB`
        : `${kb.toFixed(1)} KB`;
}

/**
 * Clamp a value between lo and hi (inclusive).
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Read a persisted setting from localStorage, with a typed fallback.
 * @param {string} key
 * @param {string|null} fallback
 * @returns {string|null}
 */
function loadSetting(key, fallback) {
    const v = localStorage.getItem(key);
    return v !== null ? v : fallback;
}

/**
 * Write a setting to localStorage (silently ignores quota / private-mode errors).
 * @param {string} key
 * @param {string} value
 */
function saveSetting(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
}
