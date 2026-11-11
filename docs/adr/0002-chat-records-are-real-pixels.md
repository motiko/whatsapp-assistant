# Chat Records are real pixels, not re-rendered

A Chat Record exists to be a trustworthy record of what was said, so it is built from WhatsApp Web's own rendered pixels (scrolled, captured, cropped and stitched), never from message text redrawn in a layout of our own. A re-render would be tidier and would allow redaction or custom styling, but it would no longer look like what WhatsApp showed, which defeats the purpose. Anything we add, such as the Context Band, sits outside the WhatsApp pixels and never alters them.
