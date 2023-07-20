const ws = require("ws");

/**
 * That's taken from the Node docs because the function which does that in the
 * Node library is deprecated in favor of copy/pasting this code into your code
 * for no apparent reason. Really what is wrong with JS?
 *
 * @param from Base URL
 * @param to Relative URL
 * @returns {string}
 */
function urljoin(from, to) {
    const resolvedUrl = new URL(to, new URL(from, "resolve://"));

    if (resolvedUrl.protocol === "resolve:") {
        const { pathname, search, hash } = resolvedUrl;
        return pathname + search + hash;
    }

    return resolvedUrl.toString();
}

/**
 * Joining a base URL and a path to get a WebSocket URL.
 *
 * @param base Base URL to join
 * @param path Path to append
 * @returns {string}
 */
function wsJoin(base, path) {
    return urljoin(base, path).replace(/^http/, "ws");
}

const PENDING = 1;
const OPEN = 2;
const DONE = 3;
const ERROR = 4;

class PromSock {
    constructor(
        url,
        {
            retries = 10,
            waitBeforeRetry = 1000,
            baseUrl = "",
            onRestore = () => {},
        }
    ) {
        this.baseUrl = baseUrl;
        this.url = url;
        this.ttl = retries;
        this.waitBeforeRetry = waitBeforeRetry;
        this.onRestore = onRestore;
        this.socket = null;
        this.state = PENDING;
        this.nextMessagePromise = null;
    }

    connect() {
        if (![PENDING, ERROR].includes(this.state)) {
            throw new Error("Cannot connect to a socket which is not pending.");
        }

        const url = wsJoin(this.baseUrl, this.url);
        this.socket = new ws(url);

        this.socket.on("open", () => {
            this.state = OPEN;
            this.onRestore();
        });

        this.socket.on("message", (data) => {
            try {
                const parsed = JSON.parse(data);

                if (this.nextMessagePromise) {
                    this.nextMessagePromise.resolve(parsed);
                    this.nextMessagePromise = null;
                }
            } catch (e) {
                if (this.nextMessagePromise) {
                    this.nextMessagePromise.reject(e);
                    this.nextMessagePromise = null;
                }
            }
        });

        this.socket.on("close", ({ code }) => {
            this.socket = null;

            if (code === 1000) {
                this.state = DONE;

                if (this.nextMessagePromise) {
                    this.nextMessagePromise.resolve(null);
                    this.nextMessagePromise = null;
                }
            } else {
                this.state = ERROR;
                this.ttl -= 1;

                if (this.ttl > 0) {
                    setTimeout(() => {
                        this.connect();
                    }, this.waitBeforeRetry);
                } else {
                    if (this.nextMessagePromise) {
                        this.nextMessagePromise.reject(
                            new Error(
                                `WebSocket closed with code ${code} after ` +
                                    `too many retries`
                            )
                        );
                        this.nextMessagePromise = null;
                    }
                }
            }
        });

        this.socket.on("error", () => {
            // do nothing, because we're dealing with it in clos event
        });
    }

    nextMessage() {
        if (this.state === DONE) {
            throw new Error("Cannot get next message from a closed socket.");
        }

        return new Promise((resolve, reject) => {
            this.nextMessagePromise = { resolve, reject };
        });
    }

    send(data) {
        if (this.state !== OPEN) {
            throw new Error("Cannot send data to a non-open socket.");
        }

        this.socket.send(JSON.stringify(data));
    }

    close() {
        if (this.socket) {
            this.socket.close();
        }
    }
}

module.exports = {
    PromSock,
};
