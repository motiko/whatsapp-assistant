# Run as a Chrome extension on WhatsApp Web

The assistant works on the user's personal WhatsApp chats, so it runs as a Chrome extension on top of WhatsApp Web and reads the page the user is already logged into. The official WhatsApp Business Cloud API cannot see personal chats, and unofficial protocol libraries (Baileys, whatsmeow) violate WhatsApp's terms and risk a ban on the number. The accepted cost is coupling to WhatsApp Web's page structure, which can change without notice; tests run against saved page snapshots so breakage is caught and localised.
