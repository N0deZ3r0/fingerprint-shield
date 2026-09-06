/**
 * The extension speaks two languages now.
 *
 * Chrome substitutes __MSG_key__ in the MANIFEST and in CSS, and nowhere else — an
 * extension page is a plain document and gets no substitution at all. So the markup carries
 * the key in a data attribute and this file fills it in once, at DOMContentLoaded, before
 * anything is painted:
 *
 *     <b data-i18n="heroTitleOn">Защита активна</b>
 *     <input data-i18n-placeholder="countrySearch">
 *     <button data-i18n-aria-label="webrtcToggle">
 *
 * THE TEXT IN THE MARKUP IS KEPT, not replaced with an empty element. It is the Russian
 * original, it is what shows if this script ever fails to run, and it makes the HTML
 * readable on its own — which matters here, because every one of these files carries long
 * comments explaining why an element exists and a page of `data-i18n` stubs would make them
 * unreadable.
 *
 * A MISSING KEY IS LOUD. chrome.i18n.getMessage returns '' for a key that is not in the
 * catalogue, and writing that empty string into the DOM would silently blank the UI — the
 * exact failure this project keeps finding in its own instruments. So an empty answer leaves
 * the markup's own text alone and reports the key on the console instead.
 */
(function () {
    'use strict';

    /** The message, or null when the catalogue does not have it. */
    function msg(key) {
        try {
            const s = chrome.i18n.getMessage(key);
            return (typeof s === 'string' && s !== '') ? s : null;
        } catch (e) { return null; }
    }

    const missing = [];

    /**
     * Write a message into an element, keeping the one piece of markup these pages put inside
     * a sentence: <code>defaults.js</code>. textContent alone would delete it, and innerHTML
     * would hand the catalogue a script sink for no reason — so the tag is parsed here, by
     * hand, and nothing else in the string is treated as markup.
     */
    function write(el, s) {
        if (s.indexOf('<code>') < 0) { el.textContent = s; return; }
        el.textContent = '';
        const parts = s.split(/<code>([\s\S]*?)<\/code>/);
        for (let i = 0; i < parts.length; i++) {
            if (!parts[i]) continue;
            if (i % 2) {
                const c = document.createElement('code');
                c.textContent = parts[i];
                el.appendChild(c);
            } else {
                el.appendChild(document.createTextNode(parts[i]));
            }
        }
    }

    function apply(root) {
        const doc = root || document;
        doc.querySelectorAll('[data-i18n]').forEach(function (el) {
            const key = el.getAttribute('data-i18n');
            const s = msg(key);
            if (s === null) { missing.push(key); return; }
            write(el, s);
        });
        [['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria-label', 'aria-label'],
            ['data-i18n-title', 'title']].forEach(function (pair) {
            doc.querySelectorAll('[' + pair[0] + ']').forEach(function (el) {
                const key = el.getAttribute(pair[0]);
                const s = msg(key);
                if (s === null) { missing.push(key); return; }
                el.setAttribute(pair[1], s);
            });
        });
        // The markup ships lang="ru" because that is what its own text is. Once the catalogue
        // has been applied that is no longer true, and the attribute is not decoration: it
        // picks the hyphenation rules and tells a screen reader which voice to use.
        try {
            const ui = chrome.i18n.getUILanguage();
            if (ui) document.documentElement.setAttribute('lang', ui);
        } catch (e) { /* not an extension page */ }
        if (missing.length) {
            console.warn('[AFP i18n] no message for: ' + missing.join(', ') +
                ' — the markup\'s own text is left in place');
        }
    }

    // Exposed so the scripts that BUILD rows (the country list, the profile list, every
    // status message) can ask for the same catalogue rather than carrying a second copy of
    // the strings. Named on window because these pages are plain scripts, not modules.
    window.afpMsg = function (key, subs) {
        try {
            const s = chrome.i18n.getMessage(key, subs);
            return (typeof s === 'string' && s !== '') ? s : null;
        } catch (e) { return null; }
    };
    window.afpApplyI18n = apply;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { apply(); });
    } else {
        apply();
    }
})();
