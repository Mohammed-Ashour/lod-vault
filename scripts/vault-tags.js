// Vault tags and the deck manager.
//
// Inside the Vault's generated document: a tag row on each word (add with
// "+ Tag", remove with ×), a tag filter above the list, and tags folded into
// the search text so "#food" finds them. On the Vault page itself: a Decks
// dialog to save, review and delete saved decks (scripts/decks.js), which
// Flashcards lists under "My decks".
(() => {
  const decks = () => globalThis.LodVaultDecks;
  const state = { org: null, entriesById: new Map(), activeTag: "", doc: null, onFilter: null };

  const STYLE = `
    .lv-tags { margin-top: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .lv-tag {
      display: inline-flex; align-items: center; gap: 2px; min-height: 26px; padding: 0 4px 0 10px;
      border-radius: 999px; background: var(--tint, rgba(168,218,220,.07)); border: 1px solid var(--line-strong);
      color: var(--text); font-size: 12px; font-weight: 600;
    }
    .lv-tag button {
      border: 0; background: transparent; color: var(--muted); font-size: 14px; line-height: 1;
      width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
    }
    .lv-tag button:hover, .lv-tag button:focus-visible { color: var(--text); background: var(--line-strong); }
    .lv-tag-add {
      min-height: 26px; padding: 0 10px; border-radius: 999px; border: 1px dashed var(--line-strong);
      background: transparent; color: var(--muted); font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .lv-tag-add:hover, .lv-tag-add:focus-visible { color: var(--text); border-color: var(--teal); }
    .lv-tag-input {
      min-height: 26px; width: 150px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--teal);
      background: transparent; color: var(--text); font: inherit; font-size: 12px;
    }
    .lv-tag-filter { margin-top: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
    .lv-tag-filter[hidden] { display: none; }
    .lv-tag-filter button {
      min-height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line-strong);
      background: transparent; color: var(--text-2, var(--muted)); font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .lv-tag-filter button[aria-pressed="true"] { border-color: var(--teal); color: var(--text); background: var(--tint, rgba(168,218,220,.07)); }
    .lv-tag-filter .lv-save-deck { border-style: dashed; }
    .entry.lv-tag-hidden { display: none !important; }
  `;

  function el(doc, tag, attrs = {}, text = "") {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "className") node.className = value;
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    if (text) node.textContent = text;
    return node;
  }

  function tagsFor(id) {
    return decks().tagsById(state.org)[id] || [];
  }

  function savedEntries() {
    return [...state.entriesById.values()];
  }

  // ── Per-word tag row ──────────────────────────────────────
  function renderEntryTags(entryElement) {
    const doc = entryElement.ownerDocument;
    const id = entryElement.dataset.id;
    let row = entryElement.querySelector(".lv-tags");
    if (!row) {
      row = el(doc, "div", { className: "lv-tags", role: "group", "aria-label": "Tags" });
      const actions = entryElement.querySelector(".preview-entry-actions");
      if (actions) actions.after(row);
      else entryElement.append(row);
    }
    const tags = tagsFor(id);
    const word = state.entriesById.get(id)?.word || id;
    row.replaceChildren(
      ...tags.map((tag) => {
        const chip = el(doc, "span", { className: "lv-tag", "data-tag": tag }, `#${tag}`);
        const remove = el(doc, "button", { type: "button", "aria-label": `Remove tag ${tag} from ${word}`, title: "Remove tag" }, "×");
        remove.addEventListener("click", () => {
          void updateTags(id, tags.filter((item) => item !== tag), row);
        });
        chip.append(remove);
        return chip;
      }),
      addButton(doc, id, row)
    );
    const base = entryElement.dataset.searchBase ?? entryElement.dataset.search ?? "";
    entryElement.dataset.searchBase = base;
    entryElement.dataset.search = [base, ...tags.map((tag) => `#${tag.toLowerCase()} ${tag.toLowerCase()}`)].join(" ");
  }

  function addButton(doc, id, row) {
    const button = el(doc, "button", { type: "button", className: "lv-tag-add", "aria-label": "Add a tag" }, "+ Tag");
    button.addEventListener("click", () => openTagInput(doc, id, row, button));
    return button;
  }

  function openTagInput(doc, id, row, button) {
    const listId = "lv-tag-suggestions";
    let list = doc.getElementById(listId);
    if (!list) {
      list = el(doc, "datalist", { id: listId });
      doc.body.append(list);
    }
    list.replaceChildren(...decks().listTags(state.org).map(({ tag }) => el(doc, "option", { value: tag })));
    const input = el(doc, "input", {
      type: "text",
      className: "lv-tag-input",
      list: listId,
      maxlength: "32",
      placeholder: "Tag name, Enter to add",
      "aria-label": "New tag"
    });
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const value = decks().cleanTag(input.value.replace(/^#/, ""));
      if (save && value) {
        await updateTags(id, [...tagsFor(id), value], row);
        row.querySelector(".lv-tag-add")?.focus();
      } else {
        renderEntryTags(row.closest(".entry"));
        row.querySelector(".lv-tag-add")?.focus();
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        void finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener("blur", () => { void finish(true); });
    button.replaceWith(input);
    input.focus();
  }

  async function updateTags(id, tags, row) {
    const result = await decks().setEntryTags(id, tags);
    state.org = result.org;
    const entryElement = row.closest(".entry");
    if (entryElement) renderEntryTags(entryElement);
    renderTagFilter();
    applyTagFilter();
  }

  // ── Tag filter above the list ─────────────────────────────
  function renderTagFilter() {
    const doc = state.doc;
    if (!doc) return;
    renderSyncWarning(doc);
    let bar = doc.getElementById("lv-tag-filter");
    if (!bar) {
      bar = el(doc, "div", { id: "lv-tag-filter", className: "lv-tag-filter", role: "group", "aria-label": "Filter by tag" });
      const anchor = doc.getElementById("search-status") || doc.getElementById("search-input");
      if (!anchor) return;
      anchor.after(bar);
    }
    const tags = decks().listTags(state.org, savedEntries());
    if (state.activeTag && !tags.some(({ tag }) => tag === state.activeTag)) state.activeTag = "";
    bar.hidden = !tags.length;
    const pill = (label, value) => {
      const button = el(doc, "button", { type: "button", "aria-pressed": String(state.activeTag === value) }, label);
      button.addEventListener("click", () => {
        state.activeTag = value;
        renderTagFilter();
        applyTagFilter();
      });
      return button;
    };
    const children = [el(doc, "span", {}, "Tags:"), pill("All", ""), ...tags.map(({ tag, count }) => pill(`#${tag} ${count}`, tag))];
    if (state.activeTag) {
      const save = el(doc, "button", { type: "button", className: "lv-save-deck" }, `Save #${state.activeTag} as a deck`);
      save.addEventListener("click", async () => {
        await decks().saveDeck({ name: state.activeTag, f: { tag: state.activeTag } });
        state.org = await decks().readOrg();
        renderSyncWarning(doc);
        save.textContent = "Saved to My decks";
        save.disabled = true;
      });
      children.push(save);
    }
    bar.replaceChildren(...children);
  }

  function renderSyncWarning(doc) {
    let warning = doc.getElementById("lv-tag-sync-warning");
    if (!warning) {
      warning = el(doc, "p", { id: "lv-tag-sync-warning", role: "status" });
      warning.style.cssText = "padding:12px;border:1px solid #d69b45;border-radius:8px;color:var(--text);background:var(--tint);";
      const anchor = doc.getElementById("search-status") || doc.getElementById("search-input") || doc.body.firstChild;
      if (anchor) anchor.before(warning);
      else doc.body.append(warning);
    }
    const { omitted, localOnly } = decks().syncStatus(state.org);
    warning.hidden = !localOnly;
    warning.textContent = localOnly
      ? `Tag/deck sync limit: ${omitted.tags} tags and ${omitted.decks} decks stay on this device. ${omitted.deletions} deletions are deferred and may still appear on other devices. Local data is kept; export a backup before switching devices.`
      : "";
  }

  function applyTagFilter() {
    if (!state.doc) return;
    const byId = decks().tagsById(state.org);
    for (const entryElement of state.doc.querySelectorAll(".entry[data-id]")) {
      const hidden = Boolean(state.activeTag) && !(byId[entryElement.dataset.id] || []).includes(state.activeTag);
      entryElement.classList.toggle("lv-tag-hidden", hidden);
    }
    state.onFilter?.();
  }

  async function attach(doc, { entriesById = new Map(), onFilter = null } = {}) {
    if (!doc || !decks()) return;
    state.doc = doc;
    state.entriesById = entriesById;
    state.onFilter = onFilter;
    if (!doc.getElementById("lv-tags-style")) {
      const style = el(doc, "style", { id: "lv-tags-style" });
      style.textContent = STYLE;
      doc.head.append(style);
    }
    state.org = await decks().readOrg();
    for (const entryElement of doc.querySelectorAll(".entry[data-id]")) renderEntryTags(entryElement);
    renderTagFilter();
    applyTagFilter();
  }

  // ── Deck manager dialog (Vault page) ──────────────────────
  function option(doc, value, label) {
    return el(doc, "option", { value }, label);
  }

  function field(doc, label, control) {
    const wrap = el(doc, "label", { className: "deck-field" });
    wrap.append(el(doc, "span", {}, label), control);
    return wrap;
  }

  function buildDialog(doc) {
    const dialog = el(doc, "dialog", { id: "deck-dialog", className: "deck-dialog", "aria-labelledby": "deck-dialog-title" });
    const form = el(doc, "form", { method: "dialog", className: "deck-form" });
    const name = el(doc, "input", { type: "text", id: "deck-name", maxlength: "32", required: true, placeholder: "e.g. Food nouns" });
    const tag = el(doc, "select", { id: "deck-tag" });
    const pos = el(doc, "select", { id: "deck-pos" });
    pos.append(option(doc, "", "Any"), ...Object.entries(decks().POS_LABELS).map(([value, label]) => option(doc, value, label)));
    const gender = el(doc, "select", { id: "deck-gender" });
    gender.append(option(doc, "", "Any"), ...Object.entries(decks().GENDER_LABELS).map(([value, label]) => option(doc, value, label)));
    const level = el(doc, "select", { id: "deck-level" });
    level.append(option(doc, "", "Any"), ...decks().LEVELS.map((value) => option(doc, value, value)));
    const list = el(doc, "select", { id: "deck-list" });
    list.append(option(doc, "", "Any"), option(doc, "favorites", "Favorites"), option(doc, "study", "Study list"));
    const due = el(doc, "select", { id: "deck-due" });
    due.append(option(doc, "", "Any time"), option(doc, "0", "Due today"), option(doc, "3", "Due within 3 days"), option(doc, "7", "Due within a week"));
    const leech = el(doc, "input", { type: "checkbox", id: "deck-leech" });
    const leechLabel = el(doc, "label", { className: "deck-check", for: "deck-leech" });
    leechLabel.append(leech, doc.createTextNode(" Only words marked as leeches"));
    const preview = el(doc, "p", { id: "deck-preview", className: "deck-note", "aria-live": "polite" });
    const list_ = el(doc, "ul", { id: "deck-list-saved", className: "deck-saved" });
    const close = el(doc, "button", { type: "button", className: "btn-ghost", value: "close" }, "Close");
    const save = el(doc, "button", { type: "submit", className: "btn-primary", value: "save" }, "Save deck");

    form.append(
      el(doc, "h2", { id: "deck-dialog-title" }, "Decks"),
      el(doc, "p", { className: "deck-note" }, "A deck is a saved filter over your words. Flashcards lists your decks under Session → Deck → My decks. Decks sync with your tags."),
      list_,
      el(doc, "h3", {}, "New deck"),
      field(doc, "Name", name),
      el(doc, "div", { className: "deck-grid" }),
      leechLabel,
      preview,
      el(doc, "div", { className: "deck-actions" })
    );
    const grid = form.querySelector(".deck-grid");
    grid.append(field(doc, "Tag", tag), field(doc, "Word type", pos), field(doc, "Gender", gender), field(doc, "Level", level), field(doc, "List", list), field(doc, "Due", due));
    form.querySelector(".deck-actions").append(close, save);
    dialog.append(form);

    const readFilter = () => decks().normalizeFilter({
      tag: tag.value,
      pos: pos.value,
      gender: gender.value,
      level: level.value,
      list: list.value,
      leech: leech.checked,
      dueWithin: due.value === "" ? undefined : Number(due.value)
    });
    const updatePreview = async () => {
      const filter = readFilter();
      const entries = await globalThis.LodVaultStore.getEntries();
      const [meta, lexicon] = await Promise.all([
        globalThis.LodVaultStore.getFlashcardMeta(),
        decks().readLexicon(entries.map((entry) => entry.id))
      ]);
      const context = { meta, lexicon, tags: decks().tagsById(state.org) };
      const count = entries.filter((entry) => decks().matchesFilter(entry, filter, context)).length;
      preview.textContent = `${count} word${count === 1 ? "" : "s"} · ${decks().describeFilter(filter)}`;
    };
    form.addEventListener("change", () => { void updatePreview(); });
    close.addEventListener("click", () => dialog.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!name.value.trim()) {
        name.focus();
        return;
      }
      await decks().saveDeck({ name: name.value, f: readFilter() });
      name.value = "";
      state.org = await decks().readOrg();
      renderSavedDecks(doc);
      name.focus();
    });

    dialog.refresh = async () => {
      state.org = await decks().readOrg();
      tag.replaceChildren(option(doc, "", "Any"), ...decks().listTags(state.org).map(({ tag: value }) => option(doc, value, `#${value}`)));
      renderSavedDecks(doc);
      await updatePreview();
    };
    return dialog;
  }

  function renderSavedDecks(doc) {
    renderSyncWarning(doc);
    const list = doc.getElementById("deck-list-saved");
    if (!list) return;
    const saved = decks().listDecks(state.org);
    if (!saved.length) {
      list.replaceChildren(el(doc, "li", { className: "deck-empty" }, "No saved decks yet."));
      return;
    }
    list.replaceChildren(...saved.map((deck) => {
      const item = el(doc, "li", {});
      item.append(el(doc, "strong", {}, deck.name), el(doc, "span", { className: "deck-note" }, decks().describeFilter(deck.f)));
      const remove = el(doc, "button", { type: "button", className: "icon-btn is-danger", "aria-label": `Delete deck ${deck.name}`, title: "Delete deck" }, "×");
      remove.addEventListener("click", async () => {
        await decks().deleteDeck(deck.id);
        state.org = await decks().readOrg();
        renderSavedDecks(doc);
      });
      item.append(remove);
      return item;
    }));
  }

  function attachDeckManager(doc = document) {
    const trigger = doc.getElementById("open-decks");
    if (!trigger || !decks()) return null;
    let dialog = null;
    trigger.addEventListener("click", async () => {
      if (!dialog) {
        dialog = buildDialog(doc);
        doc.body.append(dialog);
      }
      await dialog.refresh();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      doc.getElementById("deck-name")?.focus();
    });
    return trigger;
  }

  globalThis.LodVaultVaultTags = {
    attach,
    attachDeckManager,
    get activeTag() {
      return state.activeTag;
    }
  };
})();
