export const SERVER_MESSAGES = {
    nameEmpty: "Enter a name. It's shown in your route list.",
    nameFormat: 'Use up to 24 letters, numbers, spaces or dashes.',
    nameReservedWord: "This name can't be used. Choose another name.",
    nameReservedSource: (name: string) => `'${name}' is already used as a source in Incyclist. Choose another name.`,
    nameDuplicate: (name: string) => `You already have a server called '${name}'. Choose another name.`,

    urlWhitespace: "Addresses can't contain spaces or line breaks. Check you copied only the address.",
    urlCredentials: "Addresses with a user name or password can't be added.",
    urlQuery: "Addresses can't contain a query string (everything after a ?). Use the plain address of the server.",
    urlNotAUrl: "This doesn't look like a web address. Check for typos.",
    urlHttpInternet: "Plain http:// only works for servers on your home network. For servers on the internet, use an https:// address.",
    urlHttpNotSupported: "This device can't use servers without https:// yet. Use an https:// address.",
    urlDuplicate: (name: string) => `You've already added this server as '${name}'.`,
    urlBuiltIn: "This is Incyclist's own server. It's already included.",

    probeUnreachable: "Couldn't reach this address. Check it, and check that you're online.",
    probeNotAServer: "This address answered, but it isn't a route server. Check you copied the full address.",
    probeServerError: "The server didn't respond properly. Try again later, or ask its operator.",
    probeLocalHint: "On phones and tablets, the server's IP address (for example 192.168.1.20) often works better than its name.",

    localNote: "Local server — traffic isn't encrypted. Use this only on your home network.",
    localNoteShort: "Local server — traffic isn't encrypted.",

    trustNote: "Routes come from the server's operator, not from Incyclist. Only add servers you trust.",
    knownNote: 'Listed servers were checked to work with Incyclist. Their content comes from their operators.',
    emptyConfirm: 'This server works but has no routes yet. Add it anyway?',

    statusChecking: 'Checking…',
    statusNoRoutes: 'No routes yet',
    statusUnreachable: "Couldn't be reached last time. Routes you already have still work.",
    statusBuiltIn: 'Built in',
    found: (count: number) => `Found ${count} ${count === 1 ? 'route' : 'routes'}.`,
    routes: (count: number) => `${count} ${count === 1 ? 'route' : 'routes'}`,
} as const
