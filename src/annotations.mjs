import { createAnnotationClient as createClient } from "./annotations/client.mjs";
import { normalizeText, validSelector } from "./social-reading/anchor.mjs";
import { createMarkRenderer } from "./annotations/marks.mjs";
import { createSessionTimer } from "./session-timer.mjs";

export function canonicalText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeName === "BR") return " ";
  if (["SCRIPT", "STYLE", "NAV", "FOOTER", "BUTTON"].includes(node.nodeName))
    return "";
  return [...node.childNodes].map(canonicalText).join("");
}

export function captureSelection(main, manifest, selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
    return null;
  const range = selection.getRangeAt(0);
  const element = (n) => (n.nodeType === 1 ? n : n.parentElement);
  const paragraph = element(range.startContainer)?.closest("p");
  if (
    !paragraph ||
    !main.contains(paragraph) ||
    paragraph !== element(range.endContainer)?.closest("p")
  )
    throw Error("Select text within one supported paragraph.");
  const block = manifest.blocks.find(
    (b) =>
      b.block === `p-${[...main.querySelectorAll("p")].indexOf(paragraph)}`,
  );
  if (!block || normalizeText(canonicalText(paragraph)) !== block.quote)
    throw Error(
      "This passage is changed or unsupported. Return to the original text.",
    );
  const prefix = range.cloneRange();
  prefix.selectNodeContents(paragraph);
  prefix.setEnd(range.startContainer, range.startOffset);
  const rawPrefix = canonicalText(prefix.cloneContents());
  let start = normalizeText(rawPrefix).length;
  if (start && /\s$/.test(rawPrefix)) start++;
  const quote = normalizeText(canonicalText(range.cloneContents()));
  const selector = { start, end: start + quote.length, quote };
  if (!validSelector(block.quote, selector))
    throw Error(
      "This selection cannot be anchored exactly. Select the passage instead.",
    );
  return { paragraph, block, selector };
}

export function mountAnnotations({
  document: doc = document,
  client = createClient(),
} = {}) {
  const stamp = doc.querySelector("#sr-page-context"),
    main = doc.querySelector("main#main-content");
  if (!stamp || !main || doc.querySelector("#sr-panel")) return;
  const manifest = JSON.parse(stamp.textContent);
  if (
    manifest.schema !== "social-reading-page-v1" ||
    manifest.normalization !== "js-whitespace-v1"
  )
    return;
  doc.documentElement.dataset.srEnabled = "true";
  const make = (tag, text) => {
    const e = doc.createElement(tag);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const authorHeading = (tag, person) => {
    const name = String(person.name ?? person.author ?? "Participant");
    const identity = String(person.author ?? name);
    let hash = 2166136261;
    for (const character of identity) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
    const heading = make(tag);
    heading.className = `sr-author sr-author-${hash % 4}`;
    const initials = make("span", name.trim().split(/\s+/u).slice(0, 2).map(word => [...word][0]).join(""));
    initials.className = "sr-initials";
    initials.setAttribute("aria-hidden", "true");
    heading.append(initials, make("span", name));
    return heading;
  };
  const button = (text, action) => {
    const e = make("button", text);
    e.type = "button";
    e.addEventListener("click", action);
    return e;
  };
  const entry = button("Discuss this page", () => open(captured));
  entry.id = "sr-entry";
  entry.setAttribute("aria-controls", "sr-panel");
  entry.setAttribute("aria-expanded", "false");
  const panel = make("aside");
  panel.id = "sr-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Textbook discussion");
  const heading = make("h2", "Passage notes");
  const close = button("Close", () => closePanel());
  close.setAttribute("aria-label", "Close discussion");
  const header = make("div");
  header.className = "sr-header";
  header.append(heading, close);
  const status = make("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-atomic", "true");
  let statusRevision = 0, checkingStatus = null;
  const quote = make("blockquote");
  quote.tabIndex = 0;
  quote.setAttribute("aria-label", "Selected passage");
  quote.className = "sr-selected-passage";
  const chooser = make("select");
  chooser.setAttribute("aria-label", "Choose a passage");
  for (const b of manifest.blocks) {
    const o = make("option", `Passage ${manifest.blocks.indexOf(b) + 1}: ${b.quote}`);
    o.value = b.block;
    chooser.append(o);
  }
  const use = button("Use whole passage", () => {
    try {
      pick(blockSelection(chooser.value));
      if (actor) run(loadThreads);
    } catch (e) {
      say(e.message);
    }
  });
  const login = make("form");
  const username = make("input");
  username.name = "username";
  username.autocomplete = "username";
  username.required = true;
  const password = make("input");
  password.name = "password";
  password.type = "password";
  password.autocomplete = "current-password";
  password.required = true;
  let fieldCount = 0;
  const field = (name, input) => {
    input.id = `sr-input-${++fieldCount}`;
    const label = make("label", name);
    label.htmlFor = input.id;
    const error = make("p");
    error.id = `${input.id}-error`;
    input.setAttribute("aria-describedby", `${input.getAttribute("aria-describedby") ?? ""} ${error.id}`.trim());
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      error.textContent = "";
    });
    const wrapper = make("div");
    wrapper.append(label, input, error);
    return wrapper;
  };
  const exactQuote = make("input");
  exactQuote.type = "text";
  const occurrence = make("input");
  occurrence.type = "number";
  occurrence.min = "1";
  occurrence.value = "1";
  const quoteError = make("p");
  quoteError.id = "sr-quote-error";
  exactQuote.setAttribute("aria-describedby", quoteError.id);
  occurrence.setAttribute("aria-describedby", quoteError.id);
  const useQuote = button("Use exact quote", () => {
    let invalidControl = exactQuote;
    exactQuote.removeAttribute("aria-invalid");
    occurrence.removeAttribute("aria-invalid");
    try {
      const value = blockSelection(chooser.value), text = value.block.quote;
      const needle = exactQuote.value, count = Number(occurrence.value);
      if (!needle) throw Error("Enter text from the passage.");
      if (!Number.isSafeInteger(count) || count < 1 || count > text.length) {
        invalidControl = occurrence;
        throw Error("Enter a valid occurrence number of at least 1.");
      }
      let start = -1;
      for (let i = 0; i < count; i++) {
        start = text.indexOf(needle, start + 1);
        if (start < 0) {
          if (i > 0) invalidControl = occurrence;
          throw Error("That quote occurrence is not in this passage. Check the text and occurrence number.");
        }
      }
      const selector = { start, end: start + needle.length, quote: needle };
      if (!validSelector(text, selector)) throw Error("Select complete characters from the passage.");
      pick({ ...value, selector });
      quoteError.textContent = "";
      exactQuote.removeAttribute("aria-invalid");
      say("Exact quote selected.");
      if (actor) run(loadThreads);
    } catch (error) {
      invalidControl.setAttribute("aria-invalid", "true");
      quoteError.textContent = error.message;
      say(error.message);
    }
  });
  const signIn = make("button", "Sign in");
  signIn.type = "submit";
  login.append(
    make("p", "Sign in to save personal highlights or join your course discussion."),
    field("Username", username),
    field("Password", password),
    signIn,
  );
  const member = make("section");
  member.hidden = true;
  const identity = make("p");
  const signOut = button("Sign out", () =>
    run(async () => {
      await client.logout();
      revoke();
      say("Signed out. Page drafts were cleared.");
    }),
  );
  const sessionNotice = make("aside");
  sessionNotice.id = "sr-session-notice";
  sessionNotice.setAttribute("aria-label", "Session warning");
  sessionNotice.hidden = true;
  const sessionMessage = make("p", "Your discussion session ends soon. Stay signed in to keep working.");
  sessionMessage.setAttribute("role", "alert");
  const staySignedIn = button("Stay signed in", () => run(extendSession));
  sessionNotice.append(sessionMessage, staySignedIn);
  const refresh = button("Refresh discussion", () => run(async () => { await loadThreads(); await loadMarks(); }));
  const question = make("form");
  question.className = "sr-question";
  question.setAttribute("aria-label", "Ask about this passage");
  const input = make("textarea");
  input.required = true;
  input.maxLength = 4000;
  const post = make("button", "Post question");
  post.type = "submit";
  question.append(make("h3", "Ask about this passage"), field("Your question", input), make("p", "A question is required; maximum 4,000 characters."), post);
  const recover = button("Check pending submission", () =>
    run(async () => {
      if (!pending) return;
      if (actor?.id !== pending.command.actor)
        throw Error(
          "Sign in with the original account to check this submission.",
        );
      const original = pending;
      const result = await client.receipt(
        original.command.key,
        original.command.context,
      );
      if (pending !== original) return;
      await send(original, result);
    }),
  );
  recover.hidden = true;
  const threads = make("div");
  threads.id = "sr-threads";
  member.append(identity, signOut, refresh, question, recover, threads);
  const course = make("section");
  course.id = "sr-course";
  const courseTopics = make("input");
  courseTopics.placeholder = "e.g. evidence, question";
  const courseDetails = make("details"); courseDetails.append(make("summary", "Add topics"), field("Topics (optional, comma separated)", courseTopics));
  question.insertBefore(courseDetails, post);
  course.append(make("p", "Course discussion · visible to admitted course members"), question, recover, threads);
  const personal = make("section");
  personal.id = "sr-personal";
  const note = make("textarea");
  note.maxLength = 4000;
  const topics = make("input");
  topics.placeholder = "e.g. revisit, exam";
  const saveMark = button("Save highlight", () => run(saveHighlight));
  const checkMark = button("Check pending highlight", () => run(checkHighlight));
  checkMark.hidden = true;
  const personalList = make("div");
  personalList.id = "sr-highlight-list";
  const noteDetails = make("details"); noteDetails.append(make("summary", "Add a personal note or topics"), field("Personal note (optional)", note), field("Topics (optional, comma separated)", topics));
  personal.append(make("p", "Only you · your highlights and notes are private"), saveMark, checkMark, noteDetails, personalList);
  const finding = make("section");
  finding.id = "sr-search";
  const query = make("input"); query.type = "search";
  query.placeholder = "Quote, note or topic";
  const authorFilter = make("input"); authorFilter.placeholder = "Name or username";
  const audience = make("select");
  for (const [value, label] of [["all", "All permitted annotations"], ["mine", "Mine"], ["course", "Course discussion"]]) {
    const option = make("option", label); option.value = value; audience.append(option);
  }
  const searchForm = make("form");
  const searchButton = make("button", "Search annotations"); searchButton.type = "submit";
  searchForm.append(field("Search this page", query), field("Author (optional)", authorFilter), field("Search audience", audience), searchButton);
  const results = make("div"); results.id = "sr-search-results";
  searchForm.addEventListener("submit", event => { event.preventDefault(); run(searchAnnotations); });
  const exportButton = button("Export JSON", () => run(exportAnnotations));
  finding.append(searchForm, exportButton, make("p", "Export includes only your permitted results, with exact source references."), results);
  const viewBar = make("nav"); viewBar.setAttribute("aria-label", "Annotation view"); viewBar.className = "sr-views";
  let activeView = "course", editingMark = null, highlightPending = null, pageRecords = [], marksVisible = true, markGeneration = 0, restoreGeneration = 0;
  const views = { course, personal, search: finding };
  const viewButtons = new Map();
  for (const [name, label] of [["course", "Discuss"], ["personal", "My highlights"], ["search", "Find & export"]]) {
    const control = button(label, () => chooseView(name));
    control.setAttribute("aria-controls", views[name].id);
    viewButtons.set(name, control); viewBar.append(control);
  }
  const visibility = button("Hide highlights", () => {
    marksVisible = !marksVisible; renderer.setVisible(marksVisible);
    visibility.textContent = marksVisible ? "Hide highlights" : "Show highlights";
    visibility.setAttribute("aria-pressed", String(marksVisible));
  });
  visibility.setAttribute("aria-pressed", "true");
  const navigation = make("div"); navigation.className = "sr-tools"; navigation.append(refresh, visibility);
  const account = make("div"); account.className = "sr-account"; account.append(identity, signOut);
  member.replaceChildren(account, viewBar, navigation, course, personal, finding);
  function chooseView(name) {
    activeView = name;
    for (const [key, surface] of Object.entries(views)) {
      surface.hidden = name !== key; viewButtons.get(key).setAttribute("aria-pressed", String(name === key));
    }
  }
  chooseView("course");
  const advanced = make("details"); advanced.className = "sr-passage-tools";
  advanced.append(make("summary", "Choose a passage with the keyboard"), chooser, use,
    make("p", "Choose a whole passage, or enter an exact quote. Choose its occurrence when the text repeats."),
    field("Exact quote (optional)", exactQuote), field("Quote occurrence", occurrence), useQuote, quoteError);
  const content = make("div");
  content.className = "sr-content";
  content.append(
    make("p", "Select text in the reading to highlight it or discuss it with your course."),
    quote, status, login, member, advanced,
  );
  panel.append(header, content);
  doc.body.append(entry, panel, sessionNotice);
  let selected = null,
    actor = null,
    pending = null,
    busy = false,
    viewGeneration = 0,
    queuedOpen = null,
    queuedSelection = null,
    threadLoadGeneration = 0,
    restore = null;
  const renderer = createMarkRenderer({ document: doc, main, manifest, onSelect: showMarkChoices });
  const quick = make("div"); quick.id = "sr-quick-actions"; quick.hidden = true;
  quick.setAttribute("aria-label", "Selected text actions");
  quick.append(button("Highlight", async () => { const value = captured; if (value && !value.error) { await open(value); chooseView("personal"); if (actor) saveMark.focus({ preventScroll: true }); }}),
    button("Discuss", async () => { const value = captured; if (value && !value.error) { await open(value); chooseView("course"); if (actor) input.focus({ preventScroll: true }); }}));
  quick.addEventListener("pointerdown", event => event.preventDefault());
  doc.body.append(quick);
  const drafts = new Map();
  const noteDrafts = new Map();
  const saveNoteDraft = () => { if (actor && selected) noteDrafts.set(`${actor.id}:${key()}`, {text:note.value,tags:topics.value,editing:editingMark}); };
  note.addEventListener("input", saveNoteDraft); topics.addEventListener("input", saveNoteDraft);
  let suspendedDrafts = null;
  const sessionTimer = createSessionTimer({
    onWarning: () => { if (actor) sessionNotice.hidden = false; },
    onExpired: () => {
      if (!actor) return;
      revoke(true);
      sessionMessage.textContent = "Your discussion session expired. Reopen discussion and sign in with the same account to recover your draft.";
      staySignedIn.hidden = true;
      sessionNotice.hidden = false;
      say("Session expired. Sign in with the same account to recover your draft.");
    },
  });
  doc.addEventListener("visibilitychange", () => sessionTimer.check());
  async function extendSession() {
    if (!actor) return;
    const expected = actor.id, previousExpiry = actor.timing?.expiresAt;
    let current;
    try { current = await client.extendSession(expected); }
    catch (error) {
      if (error.code === "IDENTITY_CHANGED") revoke();
      if (error.status && error.status < 500) throw error;
      current = await client.session();
      if (!(current.timing?.expiresAt > previousExpiry)) throw error;
    }
    if (current.id !== expected) {
      revoke();
      throw Error("Account changed. Sign in again; private drafts were cleared.");
    }
    actor = current;
    sessionTimer.update(current.timing);
    sessionNotice.hidden = true;
    say("Session extended. Your draft is unchanged.");
    if (doc.activeElement === staySignedIn || doc.activeElement === doc.body)
      (panel.hidden ? entry : close).focus({ preventScroll: true });
  }
  const key = () =>
    selected
      ? JSON.stringify([selected.block.block, selected.selector ?? null])
      : "";
  const say = (text) => {
    checkingStatus = null;
    status.textContent = text;
    return ++statusRevision;
  };
  const finishChecking = (revision, text) => {
    if (revision !== null && checkingStatus === revision && statusRevision === revision)
      say(text);
  };
  const lock = () => {
    staySignedIn.disabled = busy;
    for (const b of panel.querySelectorAll("button"))
      if (b !== close) b.disabled = busy || (b.dataset.srReply !== undefined && (!!pending || b.dataset.srReply === "orphan"));
    for (const composer of panel.querySelectorAll("textarea"))
      composer.disabled = busy || !!pending;
    post.disabled = busy || !!pending || !selected;
    use.disabled = busy || !!pending;
    useQuote.disabled = busy || !!pending;
    exactQuote.disabled = busy || !!pending;
    occurrence.disabled = busy || !!pending;
    chooser.disabled = busy || !!pending;
    note.disabled = topics.disabled = busy || !!pending || !!highlightPending;
    courseTopics.disabled = busy || !!pending;
    recover.hidden = !pending;
    saveMark.disabled = busy || !actor || !selected || !!highlightPending;
    checkMark.hidden = !highlightPending || highlightPending.command.actor !== actor?.id;
  };
  function revoke(preserveDrafts = false) {
    const focused = doc.activeElement;
    const hadMemberFocus = member.contains(focused);
    const hadWarningFocus = sessionNotice.contains(focused);
    if (preserveDrafts && actor) {
      if (selected) { drafts.set(key(), input.value); drafts.set(`topics:${key()}`, courseTopics.value); }
      suspendedDrafts = { actor: actor.id, entries: [...drafts] };
    } else if (!preserveDrafts) suspendedDrafts = null;
    sessionTimer.clear();
    sessionNotice.hidden = true;
    queuedSelection = null;
    threadLoadGeneration++;
    if (preserveDrafts) saveNoteDraft(); else noteDrafts.clear();
    restoreGeneration++; markGeneration++;
    renderer.clear(); pageRecords = []; personalList.replaceChildren(); results.replaceChildren();
    note.value = ""; topics.value = ""; query.value = ""; authorFilter.value = ""; editingMark = null;
    actor = null;
    drafts.clear();
    input.value = "";
    courseTopics.value = "";
    threads.replaceChildren();
    member.hidden = true;
    login.hidden = false;
    identity.textContent = "";
    if (preserveDrafts && suspendedDrafts) {
      sessionMessage.textContent = "Your discussion session expired. Reopen discussion and sign in with the same account to recover your draft.";
      staySignedIn.hidden = true;
      sessionNotice.hidden = false;
    }
    lock();
    if ((hadWarningFocus || (!panel.hidden && hadMemberFocus)) &&
        (doc.activeElement === focused || doc.activeElement === doc.body))
      (panel.hidden ? entry : username).focus();
  }
  async function run(action) {
    if (busy) return;
    restoreGeneration++;
    const initiator = doc.activeElement;
    const replyThread = initiator?.closest(".sr-thread")?.dataset.srThread;
    let userMoved = false;
    const moved = event => {
      if (event.target !== initiator && (event.type === "pointerdown" || event.target !== doc.body)) userMoved = true;
    };
    doc.addEventListener("focusin", moved);
    doc.addEventListener("pointerdown", moved);
    busy = true;
    const generation = viewGeneration;
    lock();
    try {
      await action();
    } catch (e) {
      if (generation === viewGeneration) {
        if (e.status === 401 || e.status === 403) revoke(e.status === 401);
        say(e.message);
        if (initiator === staySignedIn) {
          sessionMessage.textContent = `${e.message} ${actor ? "Your session extension was not confirmed. You can try again." : "Reopen discussion to sign in again."}`;
          staySignedIn.hidden = !actor;
          sessionNotice.hidden = false;
        }
      }
    } finally {
      busy = false;
      lock();
      doc.removeEventListener("focusin", moved);
      doc.removeEventListener("pointerdown", moved);
      const active = doc.activeElement;
      const lostFocus = !initiator?.isConnected || !!initiator?.closest("[hidden]") ||
        (active === doc.body && initiator !== doc.body && (panel.contains(initiator) || sessionNotice.contains(initiator)));
      const recoverableSurface = !panel.hidden || (!sessionNotice.hidden && sessionNotice.contains(initiator));
      if (recoverableSurface && !userMoved && generation === viewGeneration && lostFocus &&
          (active === initiator || active === doc.body || !active?.isConnected)) {
        const reply = [...threads.querySelectorAll(".sr-thread")]
          .find(row => row.dataset.srThread === replyThread)?.querySelector("textarea");
        const survivingInitiator = initiator?.isConnected && !initiator.closest("[hidden]") && !initiator.disabled ? initiator : null;
        const target = survivingInitiator ?? (panel.hidden ? entry : actor ? (activeView === "personal" ? (highlightPending ? checkMark : saveMark) : activeView === "search" ? query : (reply ?? (pending ? recover : input))) : username);
        (target.disabled ? close : target).focus();
      }
      if (queuedSelection && !panel.hidden && generation === viewGeneration) {
        const next = queuedSelection;
        queuedSelection = null;
        applyOpenSelection(next);
      }
      if (queuedOpen && !panel.hidden) {
        const next = queuedOpen;
        queuedOpen = null;
        void open(next.value, true);
      }
    }
  }
  function blockSelection(id) {
    const block = manifest.blocks.find((b) => b.block === id);
    const paragraph = main.querySelectorAll("p")[Number(id.slice(2))];
    if (
      !block ||
      !paragraph ||
      normalizeText(canonicalText(paragraph)) !== block.quote
    )
      throw Error(
        "This passage is changed or unsupported. Return to the original text.",
      );
    return { block, paragraph };
  }
  function pick(value) {
    if (pending || highlightPending)
      throw Error("Check the pending submission before changing passages.");
    if (selected) { drafts.set(key(), input.value); drafts.set(`topics:${key()}`, courseTopics.value); saveNoteDraft(); }
    selected = value;
    editingMark = null; note.value = ""; topics.value = ""; saveMark.textContent = "Save highlight";
    if (actor) {
      const savedNote = noteDrafts.get(`${actor.id}:${key()}`);
      if (savedNote) { note.value = savedNote.text; topics.value = savedNote.tags; editingMark = savedNote.editing; saveMark.textContent = editingMark ? "Save changes" : "Save highlight"; }
    }
    exactQuote.value = value.selector?.quote ?? "";
    let occurrenceIndex = 1;
    if (value.selector) {
      let position = value.block.quote.indexOf(value.selector.quote);
      while (position >= 0 && position < value.selector.start) {
        occurrenceIndex++;
        position = value.block.quote.indexOf(value.selector.quote, position + 1);
      }
    }
    occurrence.value = String(occurrenceIndex);
    captured = value;
    exactQuote.removeAttribute("aria-invalid");
    occurrence.removeAttribute("aria-invalid");
    quoteError.textContent = "";
    chooser.value = value.block.block;
    quote.textContent = value.selector?.quote ?? value.block.quote;
    input.value = drafts.get(key()) ?? "";
    courseTopics.value = drafts.get(`topics:${key()}`) ?? "";
    threads.replaceChildren();
    lock();
  }
  function closePanel() {
    finishChecking(checkingStatus, "");
    viewGeneration++;
    queuedOpen = null;
    queuedSelection = null;
    if (selected) { drafts.set(key(), input.value); drafts.set(`topics:${key()}`, courseTopics.value); saveNoteDraft(); }
    panel.hidden = true;
    doc.body.append(sessionNotice);
    entry.setAttribute("aria-expanded", "false");
    delete doc.documentElement.dataset.srComposing;
    delete doc.documentElement.dataset.srPanel;
    threadLoadGeneration++;
    if (restore) {
      const original = restore.focus;
      const target = original?.isConnected && original !== doc.body && !original.closest("[hidden]") ? original : entry;
      target.focus?.({ preventScroll: true });
      window.scrollTo(restore.x, restore.y);
    }
  }
  async function authorize() {
    const generation = viewGeneration;
    const checking = checkingStatus;
    const previous = actor;
    const signedActor = await client.session();
    const receivedAt = performance.now();
    if (generation !== viewGeneration || panel.hidden) return false;
    if (previous && previous.id !== signedActor.id) revoke();
    actor = signedActor;
    const savedNote = noteDrafts.get(`${actor.id}:${key()}`);
    if (savedNote) { note.value = savedNote.text; topics.value = savedNote.tags; editingMark = savedNote.editing; saveMark.textContent = editingMark ? "Save changes" : "Save highlight"; }
    if (suspendedDrafts) {
      if (suspendedDrafts.actor === actor.id) {
        for (const [name, value] of suspendedDrafts.entries) drafts.set(name, value);
        input.value = drafts.get(key()) ?? "";
        courseTopics.value = drafts.get(`topics:${key()}`) ?? "";
      }
      suspendedDrafts = null;
    }
    const authorizedView = viewGeneration;
    await loadThreads();
    await loadMarks();
    if (authorizedView !== viewGeneration || panel.hidden || actor?.id !== signedActor.id) return false;
    staySignedIn.hidden = false;
    sessionMessage.textContent = "Your discussion session ends soon. Stay signed in to keep working.";
    sessionNotice.hidden = true;
    sessionTimer.update(actor.timing, receivedAt);
    if (actor?.id !== signedActor.id) return false;
    member.hidden = false;
    login.hidden = true;
    identity.textContent = `Signed in as ${actor.name}`;
    finishChecking(checking, "Signed in.");
    return true;
  }
  async function open(value, replay = false) {
    viewGeneration++;
    if (!replay) restore = {
      focus: doc.activeElement,
      x: window.scrollX,
      y: window.scrollY,
    };
    panel.hidden = false;
    quick.hidden = true;
    header.append(sessionNotice);
    entry.setAttribute("aria-expanded", "true");
    member.hidden = true;
    login.hidden = false;
    threads.replaceChildren();
    doc.documentElement.dataset.srComposing = "true";
    doc.documentElement.dataset.srPanel = "open";
    if (busy) {
      queuedOpen = { value };
      login.hidden = true;
      checkingStatus = say("Checking sign-in…");
      close.focus({ preventScroll: true });
      return;
    }
    if (pending || highlightPending) say(highlightPending ? "Check the pending highlight before changing passages." : "Check the pending submission before changing passages.");
    else if (value?.error) {
      selected = null;
      quote.textContent = value.error;
      lock();
    } else
      try {
        pick(value ?? selected ?? blockSelection(chooser.value));
      } catch (e) {
        selected = null;
        quote.textContent = e.message;
        say(e.message);
      }
    close.focus({ preventScroll: true });
    await run(authorize);
  }
  function context() {
    return {
      book: manifest.book,
      page: manifest.page,
      block: selected.block.block,
    };
  }
  async function loadThreads() {
    if (!actor) return;
    const view = viewGeneration;
    const expectedActor = actor.id;
    const verifyActor = async () => {
      const current = await client.session();
      if (current.id !== expectedActor) {
        revoke();
        throw Error("Account changed. Sign in again; private drafts were cleared.");
      }
    };
    await verifyActor();
    if (!selected) return;
    if (view !== viewGeneration || panel.hidden) return;
    const generation = ++threadLoadGeneration,
      c = context();
    const loaded = await client.threads(c);
    if (view !== viewGeneration || panel.hidden) return;
    await verifyActor();
    if (generation !== threadLoadGeneration || view !== viewGeneration || panel.hidden || actor?.id !== expectedActor) return;
    threads.replaceChildren();
    if (!loaded.length)
      threads.append(make("p", "No questions on this passage yet."));
    for (const t of loaded) {
      const row = make("section");
      row.className = "sr-thread";
      row.dataset.srThread = t.id;
      row.append(authorHeading("h3", t), make("p", t.text));
      if (t.tags?.length) row.append(make("p", t.tags.map(tag => `#${tag}`).join(" ")));
      if (t.anchor.selector) {
        const threadQuote = make("blockquote", t.anchor.selector.quote);
        threadQuote.tabIndex = 0;
        row.append(threadQuote);
      }
      for (const r of t.replies) {
        const message = make("div");
        message.className = "sr-reply";
        message.append(authorHeading("strong", r), make("p", r.text));
        row.append(message);
      }
      const form = make("form"),
        reply = make("textarea"),
        submit = make("button", "Post reply");
      reply.required = true;
      reply.maxLength = 4000;
      submit.type = "submit";
      submit.dataset.srReply = t.orphan ? "orphan" : "active";
      const draftKey = `reply:${t.id}`;
      reply.value = drafts.get(draftKey) ?? "";
      reply.addEventListener("input", () => drafts.set(draftKey, reply.value));
      submit.disabled = t.orphan || !!pending;
      form.append(make("p", "A reply is required; maximum 4,000 characters."), field("Your reply", reply), submit);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        run(() =>
          submitCommand(
            {
              kind: "reply",
              thread: t.id,
              version: t.version,
              text: reply.value,
            },
            () => {
              drafts.delete(draftKey);
              reply.value = "";
            },
            reply,
          ),
        );
      });
      row.append(form);
      threads.append(row);
    }
  }
  function parseTopics(value) { return value.split(",").map(v => v.trim()).filter(Boolean); }
  function searchFilters() { return { book: manifest.book, page: manifest.page, q: query.value.trim(), author: authorFilter.value.trim(), scope: audience.value }; }
  function markSelection(mark) {
    if (mark.orphan || mark.anchor.revision !== manifest.revision) throw Error("This saved passage is stale. It has not been moved.");
    const value = blockSelection(mark.anchor.block);
    if (value.block.quote !== mark.anchor.quote || (mark.anchor.selector && !validSelector(value.block.quote, mark.anchor.selector))) throw Error("This saved quote no longer matches the source.");
    return { ...value, ...(mark.anchor.selector ? { selector: mark.anchor.selector } : {}) };
  }
  async function loadMarks(allowClosed = false) {
    if (!actor || !client.annotationSearch) return;
    const generation = ++markGeneration, expected = actor.id, view = viewGeneration;
    const active = () => generation === markGeneration && actor?.id === expected && view === viewGeneration && (!panel.hidden || allowClosed);
    let loaded, current;
    try {
      loaded = await client.annotationSearch({ book: manifest.book, page: manifest.page, scope: "all" });
      if (!active()) return;
      current = await client.session();
    } catch(error) { if (!active()) return; throw error; }
    if (!active()) return;
    if (current.id !== expected) { revoke(); throw Error("Account changed. Private highlights were cleared."); }
    pageRecords = [...loaded.highlights.map(m => ({ ...m, kind: "personal" })), ...loaded.threads.map(t => ({ ...t, kind: "course" }))];
    renderer.render(pageRecords); renderer.setVisible(marksVisible);
    renderPersonal(loaded.highlights);
  }
  function showMarkChoices(records) {
    if (!actor || !records.length) return;
    const expected = actor.id;
    if (pending || highlightPending) { say("Reconcile the pending submission before opening another annotation."); return; }
    let target; try { target = markSelection(records[0]); } catch(error) { say(error.message); return; }
    void open(target).then(() => {
      if (actor?.id !== expected || panel.hidden) return;
      chooseView("personal");
      personalList.replaceChildren(make("h3", records.length > 1 ? "Choose an overlapping annotation" : "Selected annotation"));
      for (const record of records) personalList.append(markRow(record));
    });
  }
  function markRow(mark) {
    const row = make("section"); row.className = "sr-mark";
    row.append(make("p", mark.kind === "course" ? `Course discussion · ${mark.name ?? mark.author}` : "Only you"),
      make("blockquote", mark.anchor.selector?.quote ?? mark.anchor.quote));
    if (mark.text) row.append(make("p", mark.text));
    if (mark.tags?.length) row.append(make("p", mark.tags.map(t => `#${t}`).join(" ")));
    if (mark.orphan) { row.append(make("p", "Stale source · saved history retained; this mark has not moved.")); return row; }
    row.append(button("Jump to passage", () => { if (!renderer.jump(mark)) { say("This passage cannot be located in the current reading view. Return to the original source."); return; } say("Passage located in the reading."); }),
      button(mark.kind === "course" ? "Open discussion" : "Discuss this highlight", () => run(async () => { pick(markSelection(mark)); chooseView("course"); await loadThreads(); const target = mark.kind === "course" ? [...threads.querySelectorAll(".sr-thread")].find(row => row.dataset.srThread === mark.id)?.querySelector("h3") : input; if (target) { target.tabIndex = target.tabIndex || 0; target.focus({ preventScroll: true }); target.scrollIntoView({block:"nearest"}); } })));
    if (mark.kind !== "course") {
      row.append(button("Edit personal note", () => { try { pick(markSelection(mark)); chooseView("personal"); editingMark = mark; note.value = mark.text; topics.value = mark.tags.join(", "); saveMark.textContent = "Save changes"; noteDetails.open = true; note.focus({ preventScroll: true }); } catch(e) { say(e.message); } }),
        button("Delete my highlight", () => run(() => writeHighlight({ kind: "delete", highlight: mark.id, version: mark.version, context: mark.context }))));
    }
    return row;
  }
  function renderPersonal(records) {
    personalList.replaceChildren(make("h3", "Saved on this page"));
    if (!records.length) personalList.append(make("p", "No personal highlights yet. Select a passage and choose Highlight to keep it here."));
    for (const mark of records) personalList.append(markRow(mark));
  }
  async function saveHighlight() {
    if (!actor || !selected || highlightPending) return;
    const content = await client.passage(context());
    if (content.anchor.revision !== manifest.revision || content.anchor.quote !== selected.block.quote) throw Error("Source changed. Reload before saving a highlight.");
    const anchor = { ...content.anchor, ...(selected.selector ? {selector:selected.selector} : {}) };
    await writeHighlight({ kind: editingMark ? "update" : "create", context: context(),
      ...(editingMark ? { highlight: editingMark.id, version: editingMark.version } : {anchor}), text: note.value, tags: parseTopics(topics.value) });
  }
  async function writeHighlight(command) {
    if (!actor || highlightPending) return;
    highlightPending = { command: JSON.parse(JSON.stringify({ ...command, actor: actor.id, key: crypto.randomUUID() })) };
    await finishHighlight(highlightPending);
  }
  async function finishHighlight(original, receipt) {
    if (actor?.id !== original.command.actor) throw Error("Sign in with the original account to reconcile this highlight.");
    try { receipt = receipt ?? await client.highlightCommand(original.command); }
    catch (error) {
      if (error.code === "IDENTITY_CHANGED") revoke();
      if (error.status && error.status < 500 && ![401,403].includes(error.status)) { highlightPending = null; throw error; }
      if ([401,403].includes(error.status)) revoke(error.status === 401);
      say("Highlight outcome unknown. Use Check pending highlight after signing in with the original account."); return;
    }
    if (highlightPending !== original || actor?.id !== original.command.actor) return;
    const deleting = original.command.kind === "delete";
    if (!deleting || editingMark?.id === original.command.highlight) {
      noteDrafts.delete(`${original.command.actor}:${key()}`);
      editingMark = null; note.value = ""; topics.value = ""; saveMark.textContent = "Save highlight";
    }
    highlightPending = null;
    try {
      await loadMarks();
      if (actor?.id === original.command.actor) say(deleting ? "Personal highlight deleted. Other drafts are unchanged." : "Personal highlight saved. Only you can see it.");
    }
    catch(error) {
      if (actor && actor.id !== original.command.actor) return;
      if (error.status === 401 || error.status === 403) revoke(error.status === 401);
      say(`Highlight ${deleting ? "deleted" : "saved"}. Refresh to view it: ${error.message}`);
    }
  }
  async function checkHighlight() {
    if (!highlightPending || actor?.id !== highlightPending.command.actor) return;
    const original = highlightPending;
    const receipt = await client.highlightReceipt(original.command.key, original.command.context);
    if (!receipt) { say("No receipt found. Retry uses the same highlight request."); await finishHighlight(original); }
    else await finishHighlight(original, receipt);
  }
  async function searchAnnotations() {
    if (!actor) return;
    const expected = actor.id, generation = ++markGeneration, view = viewGeneration;
    const active = () => actor?.id === expected && generation === markGeneration && view === viewGeneration && !panel.hidden;
    let data, current;
    try {
      data = await client.annotationSearch(searchFilters());
      if (!active()) return;
      current = await client.session();
    } catch(error) { if (!active()) return; throw error; }
    if (!active()) return;
    if (current.id !== expected) { revoke(); throw Error("Account changed. Search results were cleared."); }
    results.replaceChildren(make("h3", "Permitted results"));
    const records = [...data.highlights.map(m => ({...m,kind:"personal"})), ...data.threads.map(t=>({...t,kind:"course"}))];
    if (!records.length) results.append(make("p", "No matching annotations on this page. Try a different quote, name or topic."));
    for (const record of records) results.append(markRow(record));
    say(`${records.length} permitted annotation results.`);
  }
  async function exportAnnotations() {
    if (!actor) return;
    const expected = actor.id, view = viewGeneration;
    const active = () => actor?.id === expected && view === viewGeneration && !panel.hidden;
    let data, current;
    try {
      data = await client.exportAnnotations(searchFilters());
      if (!active()) return;
      current = await client.session();
    } catch(error) { if (!active()) return; throw error; }
    if (!active()) return;
    if (current.id !== expected) { revoke(); throw Error("Account changed. Export cancelled."); }
    if (data.type !== "AnnotationPage" || !Array.isArray(data.items)) throw Error("Export structure was not valid.");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], {type:"application/ld+json"}));
    const download = make("a", "Download permitted annotations"); download.href = url; download.download = "libretexts-annotations.json";
    results.replaceChildren(download); download.click();
    results.replaceChildren(make("p", "JSON download started. Choose Export JSON again for another copy."));
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say("Permitted annotations exported as JSON with their original source references.");
  }
  async function submitCommand(command, clear, field = input) {
    if (pending || !actor || !selected) return;
    blockSelection(selected.block.block);
    const c = context();
    if (command.kind === "question") {
      const content = await client.passage(c);
      if (
        content.anchor.revision !== manifest.revision ||
        content.anchor.quote !== selected.block.quote
      )
        throw Error("The source revision changed. Reload before posting.");
      command.anchor = {
        ...content.anchor,
        ...(selected.selector ? { selector: selected.selector } : {}),
      };
    }
    pending = {
      command: JSON.parse(
        JSON.stringify({
          ...command,
          actor: actor.id,
          key: crypto.randomUUID(),
          context: c,
        }),
      ),
      clear,
      field,
      draftKey: command.kind === "reply" ? `reply:${command.thread}` : key(),
    };
    await send(pending);
  }
  async function send(original, receipt) {
    let result;
    try {
      result = receipt ?? (await client.command(original.command));
    } catch (e) {
      if (e.code === "IDENTITY_CHANGED") {
        revoke();
      } else if (e.status && e.status < 500) {
        if (e.body?.fieldErrors?.text) {
          original.field.setAttribute("aria-invalid", "true");
          original.field.nextElementSibling.textContent = e.body.fieldErrors.text;
        }
        pending = null;
        throw e;
      }
      say(
        "Submission outcome unknown. Sign in with the original account and check the pending submission.",
      );
      lock();
      return;
    }
    if (pending !== original) return;
    original.clear();
    if (suspendedDrafts?.actor === original.command.actor)
      suspendedDrafts.entries = suspendedDrafts.entries.filter(([name]) => name !== original.draftKey && name !== `topics:${original.draftKey}`);
    pending = null;
    lock();
    try {
      await loadThreads();
      await loadMarks();
      say(`Saved and acknowledged. Thread version ${result.version}.`);
    } catch (e) {
      if (e.status === 401 || e.status === 403) revoke(e.status === 401);
      say(
        `Saved and acknowledged. Refresh discussion to see the result: ${e.message}`,
      );
    }
  }
  login.addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      const generation = viewGeneration, revision = statusRevision;
      await client.login(username.value, password.value);
      password.value = "";
      if (generation !== viewGeneration || panel.hidden) return;
      const authorized = await authorize();
      if (authorized && generation === viewGeneration && statusRevision === revision)
        say("Signed in.");
    });
  });
  question.addEventListener("submit", (e) => {
    e.preventDefault();
    run(() =>
      submitCommand({ kind: "question", text: input.value, tags: parseTopics(courseTopics.value) }, () => {
        input.value = "";
        drafts.delete(key());
        courseTopics.value = "";
        drafts.delete(`topics:${key()}`);
      }),
    );
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    }
  });
  // Capture while the range still exists; clicking the entry button can collapse it.
  let captured = null;
  const selectionControlFocused = () => doc.activeElement === entry || quick.contains(doc.activeElement);
  const clearUnfocusedSelection = () => {
    if (!panel.hidden || selectionControlFocused() || !doc.getSelection()?.isCollapsed) return;
    captured = null; quick.hidden = true; entry.textContent = "Discuss this page";
  };
  for (const control of [entry, quick])
    control.addEventListener("focusout", () => queueMicrotask(clearUnfocusedSelection));
  let selectingText = false;
  function syncOpenSelection() {
    if (panel.hidden) return;
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || !main.contains(selection.anchorNode)) return;
    const origin = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
    if (origin?.closest("button, input, textarea, select, [contenteditable], [data-tts-ui]")) return;
    let value;
    try { value = captureSelection(main, manifest, selection); }
    catch (error) { value = { error: error.message }; }
    applyOpenSelection(value);
  }
  function applyOpenSelection(value) {
    if (!value || (!value.error && selected?.block.block === value.block.block &&
        JSON.stringify(selected.selector) === JSON.stringify(value.selector))) { queuedSelection = null; return; }
    if (pending || highlightPending) {
      queuedSelection = null;
      say("Check the pending operation before changing passages. The current passage is unchanged.");
      return;
    }
    if (busy) { queuedSelection = value; return; }
    if (value.error) {
      if (selected) { drafts.set(key(), input.value); drafts.set(`topics:${key()}`, courseTopics.value); saveNoteDraft(); }
      selected = null;
      threadLoadGeneration++;
      threads.replaceChildren();
      quote.textContent = value.error;
      captured = value;
      exactQuote.value = "";
      say(value.error);
      lock();
      return;
    }
    pick(value);
    threadLoadGeneration++;
    if (actor) void run(loadThreads);
  }
  doc.addEventListener("pointerdown", event => {
    selectingText = main.contains(event.target) && !event.target.closest("button, input, textarea, select, [contenteditable], [data-tts-ui]");
  });
  doc.addEventListener("pointerup", () => {
    if (!selectingText) return;
    selectingText = false;
    syncOpenSelection();
  });
  doc.addEventListener("pointercancel", () => { selectingText = false; });
  doc.addEventListener("selectionchange", () => {
    if (!panel.hidden) { if (!selectingText) syncOpenSelection(); return; }
    if (captured && doc.getSelection()?.isCollapsed && selectionControlFocused()) return;
    try {
      captured = captureSelection(main, manifest, doc.getSelection());
      quick.hidden = !captured || !!captured.error;
      entry.textContent = captured?.error
        ? "Selection unavailable"
        : captured
          ? "Discuss selected text"
          : "Discuss this page";
    } catch (e) {
      quick.hidden = true;
      captured = { error: e.message };
      entry.textContent = "Selection unavailable";
      say(e.message);
    }
  });
  entry.addEventListener("pointerdown", (e) => {
    if (captured) e.preventDefault();
  });
  async function restorePageMarks() {
    if (!client.annotationSearch || busy) return;
    renderer.clear();
    const generation = ++restoreGeneration;
    try {
      const current = await client.session();
      if (generation !== restoreGeneration || busy) return;
      if (actor && actor.id !== current.id) revoke();
      actor = current; sessionTimer.update(current.timing);
      await loadMarks(true);
    } catch(error) {
      if (generation === restoreGeneration && [401,403].includes(error.status)) revoke(error.status === 401);
    }
  }
  void restorePageMarks();
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "visible") void restorePageMarks();
  });
  return { panel, close: closePanel };
}
if (typeof document !== "undefined") mountAnnotations();
