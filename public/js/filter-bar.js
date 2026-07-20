// Modular filter bar. Finds every .filter-bar on the page and wires up
// toggle-button filtering against data attributes on target elements.
//
// HTML contract:
//   .filter-bar[data-target][data-section?]
//     .filter-group[data-key][data-match?][data-single?]  (match: "all" (default) | "any")
//       .filter-btn[data-value]  (toggleable)
//
// data-single: only one button in the group may be active at a time (radio-like);
//   clicking the active button clears it.
//
// Filter logic (per .filter-bar):
//   - For each .filter-group, collect its active (selected) values.
//   - A target element passes a group if the group has no active values, OR:
//       match="all" (AND, default): every active value appears in the element's
//         data-{key} (space-separated). Use for multi-valued attributes where you
//         want to narrow (e.g. Requires Str AND Dex).
//       match="any" (OR): at least one active value appears. Use for
//         single-valued attributes where selections widen (e.g. Type, Origin).
//   - AND across groups: an element must pass all groups to remain visible.
//   - If data-section is set, any section container with no visible children
//     is hidden automatically.
//   - If data-count is set, each matching container's [data-filter-count] badge
//     is updated to the number of currently-visible targets inside it, so count
//     badges track the active filter instead of showing a static total.
(function () {
  var selectId = 0;
  var openSelect = null;

  function enhanceSelect(select) {
    if (select.dataset.filterSelectInitialized === 'true') return;
    select.dataset.filterSelectInitialized = 'true';

    var label = select.getAttribute('aria-label') || 'Filter';
    var wrapper = document.createElement('span');
    var trigger = document.createElement('button');
    var triggerLabel = document.createElement('span');
    var chevron = document.createElement('span');
    var listbox = document.createElement('div');
    var id = ++selectId;
    var activeIndex = Math.max(select.selectedIndex, 0);
    var options = [];

    wrapper.className = 'filter-select-custom';
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.classList.add('filter-select--native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    trigger.type = 'button';
    trigger.className = 'filter-select-trigger';
    trigger.id = 'filter-select-trigger-' + id;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'filter-select-listbox-' + id);
    triggerLabel.className = 'filter-select-trigger__label';
    chevron.className = 'filter-select-trigger__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '\u2304';
    trigger.appendChild(triggerLabel);
    trigger.appendChild(chevron);
    wrapper.appendChild(trigger);

    listbox.className = 'filter-select-listbox';
    listbox.id = 'filter-select-listbox-' + id;
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', label);
    listbox.setAttribute('aria-labelledby', trigger.id);
    listbox.tabIndex = -1;
    listbox.hidden = true;

    Array.from(select.options).forEach(function (nativeOption, index) {
      var option = document.createElement('div');
      var marker = document.createElement('span');
      var text = document.createElement('span');
      option.className = 'filter-select-option';
      option.id = 'filter-select-option-' + id + '-' + index;
      option.setAttribute('role', 'option');
      option.dataset.index = String(index);
      marker.className = 'filter-select-option__marker';
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = '\u2713';
      text.className = 'filter-select-option__label';
      text.textContent = nativeOption.textContent;
      option.appendChild(marker);
      option.appendChild(text);
      listbox.appendChild(option);
      options.push(option);
    });
    document.body.appendChild(listbox);

    function selectedIndex() {
      return select.selectedIndex >= 0 ? select.selectedIndex : 0;
    }

    function sync() {
      var index = selectedIndex();
      triggerLabel.textContent = select.options[index] ? select.options[index].textContent : label;
      trigger.setAttribute('aria-label', label + ': ' + triggerLabel.textContent);
      trigger.disabled = select.disabled;
      options.forEach(function (option, optionIndex) {
        var selected = optionIndex === index;
        option.classList.toggle('is-selected', selected);
        option.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
    }

    function setActive(index) {
      activeIndex = Math.max(0, Math.min(options.length - 1, index));
      options.forEach(function (option, optionIndex) {
        option.classList.toggle('is-active', optionIndex === activeIndex);
      });
      if (options[activeIndex]) {
        listbox.setAttribute('aria-activedescendant', options[activeIndex].id);
        options[activeIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    function positionListbox() {
      if (listbox.hidden) return;
      if (!wrapper.isConnected) {
        close(false);
        listbox.remove();
        return;
      }
      var rect = trigger.getBoundingClientRect();
      var gutter = 8;
      var width = Math.min(rect.width, window.innerWidth - gutter * 2);
      var left = Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter));
      var availableHeight = Math.max(80, window.innerHeight - rect.bottom - gutter - 4);
      listbox.style.setProperty('--filter-select-scale',
        getComputedStyle(wrapper).getPropertyValue('--gem-index-content-scale') || '1');
      listbox.style.left = left + 'px';
      listbox.style.top = (rect.bottom + 4) + 'px';
      listbox.style.width = width + 'px';
      listbox.style.maxHeight = Math.min(300, availableHeight) + 'px';
    }

    function open() {
      if (trigger.disabled || !options.length) return;
      if (openSelect && openSelect.close !== close) openSelect.close(false);
      openSelect = { close: close };
      listbox.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      activeIndex = selectedIndex();
      positionListbox();
      setActive(activeIndex);
      listbox.focus({ preventScroll: true });
    }

    function close(restoreFocus) {
      if (listbox.hidden) return;
      listbox.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      listbox.removeAttribute('aria-activedescendant');
      if (openSelect && openSelect.close === close) openSelect = null;
      if (restoreFocus) trigger.focus({ preventScroll: true });
    }

    function choose(index) {
      var nativeOption = select.options[index];
      if (!nativeOption || nativeOption.disabled) return;
      select.value = nativeOption.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      close(true);
    }

    trigger.addEventListener('click', function () {
      if (listbox.hidden) open();
      else close(false);
    });
    trigger.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      open();
      if (event.key === 'ArrowUp') setActive(options.length - 1);
    });
    listbox.addEventListener('click', function (event) {
      var option = event.target.closest('.filter-select-option');
      if (option && listbox.contains(option)) choose(Number(option.dataset.index));
    });
    listbox.addEventListener('mousemove', function (event) {
      var option = event.target.closest('.filter-select-option');
      if (option && listbox.contains(option)) setActive(Number(option.dataset.index));
    });
    listbox.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        setActive(event.key === 'Home' ? 0 : options.length - 1);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose(activeIndex);
      } else if (event.key === 'Tab') {
        close(false);
      }
    });
    select.addEventListener('change', sync);
    document.addEventListener('pointerdown', function (event) {
      if (!listbox.hidden && !wrapper.contains(event.target) && !listbox.contains(event.target)) close(false);
    });
    document.addEventListener('scroll', positionListbox, true);
    window.addEventListener('resize', positionListbox);
    sync();
  }

  function enhanceSelects(scope) {
    var root = scope || document;
    if (root.matches && root.matches('.filter-select')) enhanceSelect(root);
    root.querySelectorAll('.filter-select').forEach(enhanceSelect);
  }

  function initFilterBars(scope) {
    enhanceSelects(scope);
    (scope || document).querySelectorAll('.filter-bar').forEach(function (bar) {
    if (bar.dataset.filterInitialized === 'true') return;
    bar.dataset.filterInitialized = 'true';
    var targetSel  = bar.dataset.target;
    var sectionSel = bar.dataset.section || null;
    var countSel   = bar.dataset.count || null;
    var groups     = Array.from(bar.querySelectorAll('.filter-group'));

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn) return;
      var group = btn.closest('.filter-group');
      if (group && group.dataset.single !== undefined) {
        // Radio-like: clear the group, then re-select unless we just cleared
        // the button that was already active.
        var wasActive = btn.classList.contains('is-active');
        group.querySelectorAll('.filter-btn.is-active')
             .forEach(function (b) { b.classList.remove('is-active'); });
        if (!wasActive) btn.classList.add('is-active');
      } else {
        btn.classList.toggle('is-active');
      }
      applyFilters();
    });

    bar.addEventListener('change', function (e) {
      if (!e.target.matches('.filter-select')) return;
      applyFilters();
    });

    // Apply any default (server-rendered is-active) selections on load.
    applyFilters();

    function applyFilters() {
      var activeFilters = groups.map(function (g) {
        return {
          key: g.dataset.key,
          match: g.dataset.match === 'any' ? 'any' : 'all',
          values: Array.from(g.querySelectorAll('.filter-btn.is-active'))
                       .map(function (b) { return b.dataset.value; })
                       .concat(Array.from(g.querySelectorAll('.filter-select'))
                         .map(function (s) { return s.value; }).filter(Boolean)),
        };
      });

      document.querySelectorAll(targetSel).forEach(function (item) {
        var visible = activeFilters.every(function (f) {
          if (!f.values.length) return true;
          var itemVals = (item.dataset[f.key] || '').split(' ').filter(Boolean);
          var has = function (v) { return itemVals.indexOf(v) !== -1; };
          return f.match === 'any' ? f.values.some(has) : f.values.every(has);
        });
        item.style.display = visible ? '' : 'none';
      });

      if (sectionSel) {
        document.querySelectorAll(sectionSel).forEach(function (section) {
          var hasVisible = Array.from(section.querySelectorAll(targetSel))
            .some(function (el) { return el.style.display !== 'none'; });
          section.style.display = hasVisible ? '' : 'none';
        });
      }

      if (countSel) {
        document.querySelectorAll(countSel).forEach(function (container) {
          var badge = container.querySelector('[data-filter-count]');
          if (!badge) return;
          badge.textContent = Array.from(container.querySelectorAll(targetSel))
            .filter(function (el) { return el.style.display !== 'none'; }).length;
        });
      }

      // Browse views may need to reconcile a selected item after filtering.
      // The filter engine remains generic; consumers opt in by listening.
      bar.dispatchEvent(new CustomEvent('filter-bar:applied', { bubbles: true }));
    }
    });
  }

  window.initFilterBars = initFilterBars;
  initFilterBars(document);
})();
