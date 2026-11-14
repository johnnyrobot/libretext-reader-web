import { createClient } from "./social-reading/client.mjs";
import { normalizeText, validSelector } from "./social-reading/anchor.mjs";
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
  const heading = make("h2", "Discuss this passage");
  const close = button("Close discussion", () => closePanel());
  const header = make("div");
  header.className = "sr-header";
  header.append(heading, close);
  const status = make("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-atomic", "true");
  const quote = make("blockquote");
  quote.tabIndex = 0;
  quote.setAttribute("aria-label", "Selected passage");
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
  const useQuote = button("Use exact quote", () => {
    try {
      const value = blockSelection(chooser.value), text = value.block.quote;
      const needle = exactQuote.value, count = Number(occurrence.value);
      if (!needle || !Number.isSafeInteger(count) || count < 1 || count > text.length)
        throw Error("Enter text from the passage and an occurrence number of at least 1.");
      let start = -1;
      for (let i = 0; i < count; i++) {
        start = text.indexOf(needle, start + 1);
        if (start < 0) throw Error("That quote occurrence is not in this passage. Check the text and occurrence number.");
      }
      const selector = { start, end: start + needle.length, quote: needle };
      if (!validSelector(text, selector)) throw Error("Select complete characters from the passage.");
      pick({ ...value, selector });
      quoteError.textContent = "";
      exactQuote.removeAttribute("aria-invalid");
      say("Exact quote selected.");
      if (actor) run(loadThreads);
    } catch (error) {
      exactQuote.setAttribute("aria-invalid", "true");
      quoteError.textContent = error.message;
      say(error.message);
    }
  });
  const signIn = make("button", "Sign in");
  signIn.type = "submit";
  login.append(
    make("p", "Both sign-in fields are required."),
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
  const refresh = button("Refresh discussion", () => run(loadThreads));
  const question = make("form");
  const input = make("textarea");
  input.required = true;
  input.maxLength = 4000;
  const post = make("button", "Post question");
  post.type = "submit";
  question.append(make("p", "A question is required; maximum 4,000 characters."), field("Your question", input), post);
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
  const content = make("div");
  content.className = "sr-content";
  content.append(
    make(
      "p",
      "Private discussion · invented demonstration course and accounts",
    ),
    chooser,
    use,
    make("p", "To discuss part of a passage using the keyboard, enter its exact text. If it appears more than once, choose the occurrence."),
    field("Exact quote (optional)", exactQuote),
    field("Quote occurrence", occurrence),
    useQuote,
    quoteError,
    quote,
    status,
    login,
    member,
  );
  panel.append(header, content);
  doc.body.append(entry, panel, sessionNotice);
  let selected = null,
    actor = null,
    pending = null,
    busy = false,
    viewGeneration = 0,
    queuedOpen = null,
    threadLoadGeneration = 0,
    restore = null;
  const drafts = new Map();
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
    status.textContent = text;
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
    recover.hidden = !pending;
  };
  function revoke(preserveDrafts = false) {
    const focused = doc.activeElement;
    const hadMemberFocus = member.contains(focused);
    if (preserveDrafts && actor) {
      if (selected) drafts.set(key(), input.value);
      suspendedDrafts = { actor: actor.id, entries: [...drafts] };
    } else if (!preserveDrafts) suspendedDrafts = null;
    sessionTimer.clear();
    sessionNotice.hidden = true;
    threadLoadGeneration++;
    actor = null;
    drafts.clear();
    input.value = "";
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
    if (!panel.hidden && hadMemberFocus && (doc.activeElement === focused || doc.activeElement === doc.body))
      username.focus();
  }
  async function run(action) {
    if (busy) return;
    const initiator = doc.activeElement;
    const replyThread = initiator?.closest(".sr-thread")?.dataset.srThread;
    let userMoved = false;
    const moved = event => {
      if (event.target !== initiator && event.target !== doc.body) userMoved = true;
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
        const target = survivingInitiator ?? (actor ? (reply ?? (pending ? recover : input)) : username);
        (target.disabled ? close : target).focus();
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
    if (pending)
      throw Error("Check the pending submission before changing passages.");
    if (selected) drafts.set(key(), input.value);
    selected = value;
    chooser.value = value.block.block;
    quote.textContent = value.selector?.quote ?? value.block.quote;
    input.value = drafts.get(key()) ?? "";
    threads.replaceChildren();
    lock();
  }
  function closePanel() {
    viewGeneration++;
    queuedOpen = null;
    if (selected) drafts.set(key(), input.value);
    panel.hidden = true;
    doc.body.append(sessionNotice);
    entry.setAttribute("aria-expanded", "false");
    delete doc.documentElement.dataset.srComposing;
    delete doc.documentElement.dataset.srPanel;
    threadLoadGeneration++;
    if (restore) {
      restore.focus?.focus({ preventScroll: true });
      window.scrollTo(restore.x, restore.y);
    }
  }
  async function authorize() {
    const generation = viewGeneration;
    const previous = actor;
    const signedActor = await client.session();
    if (generation !== viewGeneration || panel.hidden) return;
    if (previous && previous.id !== signedActor.id) revoke();
    actor = signedActor;
    if (suspendedDrafts) {
      if (suspendedDrafts.actor === actor.id) {
        for (const [name, value] of suspendedDrafts.entries) drafts.set(name, value);
        input.value = drafts.get(key()) ?? "";
      }
      suspendedDrafts = null;
    }
    const authorizedView = viewGeneration;
    await loadThreads();
    if (authorizedView !== viewGeneration || panel.hidden) return;
    member.hidden = false;
    login.hidden = true;
    identity.textContent = `Signed in as ${actor.name}`;
    staySignedIn.hidden = false;
    sessionMessage.textContent = "Your discussion session ends soon. Stay signed in to keep working.";
    sessionNotice.hidden = true;
    sessionTimer.update(actor.timing);
  }
  async function open(value, replay = false) {
    viewGeneration++;
    if (!replay) restore = {
      focus: doc.activeElement,
      x: window.scrollX,
      y: window.scrollY,
    };
    panel.hidden = false;
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
      say("Checking sign-in…");
      close.focus({ preventScroll: true });
      return;
    }
    if (pending) say("Check the pending submission before changing passages.");
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
    if (!selected || !actor) return;
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
    if (view !== viewGeneration || panel.hidden) return;
    const generation = ++threadLoadGeneration,
      c = context();
    const loaded = await client.threads(c);
    if (view !== viewGeneration || panel.hidden) return;
    await verifyActor();
    if (generation !== threadLoadGeneration || !actor) return;
    threads.replaceChildren();
    if (!loaded.length)
      threads.append(make("p", "No questions on this passage yet."));
    for (const t of loaded) {
      const row = make("section");
      row.className = "sr-thread";
      row.dataset.srThread = t.id;
      row.append(make("h3", t.name), make("p", t.text));
      if (t.anchor.selector) {
        const threadQuote = make("blockquote", t.anchor.selector.quote);
        threadQuote.tabIndex = 0;
        row.append(threadQuote);
      }
      for (const r of t.replies) row.append(make("p", `${r.name}: ${r.text}`));
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
      suspendedDrafts.entries = suspendedDrafts.entries.filter(([name]) => name !== original.draftKey);
    pending = null;
    lock();
    try {
      await loadThreads();
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
      await client.login(username.value, password.value);
      password.value = "";
      await authorize();
      say("Signed in.");
    });
  });
  question.addEventListener("submit", (e) => {
    e.preventDefault();
    run(() =>
      submitCommand({ kind: "question", text: input.value }, () => {
        input.value = "";
        drafts.delete(key());
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
  doc.addEventListener("selectionchange", () => {
    if (!panel.hidden) return;
    try {
      captured = captureSelection(main, manifest, doc.getSelection());
      entry.textContent = captured?.error
        ? "Selection unavailable"
        : captured
          ? "Discuss selected text"
          : "Discuss this page";
    } catch (e) {
      captured = { error: e.message };
      entry.textContent = "Selection unavailable";
      say(e.message);
    }
  });
  entry.addEventListener("pointerdown", (e) => {
    if (captured) e.preventDefault();
  });
  return { panel, close: closePanel };
}
if (typeof document !== "undefined") mountAnnotations();
