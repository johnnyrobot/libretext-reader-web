/* The only code that runs for a visitor who never presses the button.
 *
 * Not { once: true }: a failed first attempt -- an offline manifest, a declined
 * quota -- would leave the button permanently dead with no way back but a
 * reload. The module promise is cached instead, so the import still happens
 * exactly once. */
let pending;

const enter = document.getElementById('tts-enter');

/* Size set here, NOT as a style= attribute: the mirror's CSP is style-src 'self'
 * with no 'unsafe-inline', so an attribute is parsed and dropped -- served
 * correctly, rendered at 13px. CSP does not intercept CSSOM. 13px/6px + 25%. */
if (enter) {
  enter.style.fontSize = '16.25px';
  enter.style.gap = '7.5px';
}

enter?.addEventListener('click', async (event) => {
  event.preventDefault();
  pending ??= import('/_assets/tts/reader.js');
  const { enterReaderMode } = await pending;
  await enterReaderMode();
});
