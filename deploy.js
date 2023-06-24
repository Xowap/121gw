const fs = require("node:fs");
const ws = require("ws");
const core = require("@actions/core");

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

/**
 * Making a nice progress bar to display the progress of things.
 *
 * @param percentage
 * @param length
 * @returns {string}
 */
function createProgressBar(percentage, length = 50) {
    const filledLength = Math.round(length * percentage);
    const filled = "\u2588".repeat(filledLength);
    const empty = "\u2591".repeat(length - filledLength);
    return filled + empty;
}

function deploy({ endpoint, token, file, timeout, branch }) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            console.log(
                `\x1b[31m\x1b[1mTimeout after ${Math.round(
                    timeout / 60000
                )} minutes.\x1b[0m`
            );
            socket.close();
            reject(new Error("Timeout"));
        }, timeout * 1000);

        let fluxfile;

        try {
            fluxfile = fs.readFileSync(file, "utf-8");
        } catch (e) {
            console.log(`\x1b[31m\x1b[1mError reading file ${file}.\x1b[0m`);
            reject(e);
        }

        const wsEndpoint = wsJoin(endpoint, "/back/ws/deploy/");
        const socket = new ws(wsEndpoint);

        socket.on("open", function open() {
            socket.send(
                JSON.stringify({
                    action: "deploy",
                    token,
                    branch,
                    fluxfile,
                })
            );
        });

        let lastStep = "";

        socket.on("message", function incoming(data) {
            const message = JSON.parse(data);

            if (message.type === "update") {
                if (message.data.step !== lastStep) {
                    if (lastStep) {
                        core.endGroup();
                    }

                    core.startGroup(message.data.step);
                    lastStep = message.data.step;
                }
                console.log(
                    `\x1b[34m\x1b[1mStep progress:\x1b[0m \x1b[32m${createProgressBar(
                        message.data.progress.step
                    )} ${Math.round(message.data.progress.step * 100)}%\x1b[0m`
                );
                console.log(
                    `\x1b[34m\x1b[1mSub-step progress:\x1b[0m \x1b[32m${createProgressBar(
                        message.data.progress.sub_step
                    )} ${Math.round(
                        message.data.progress.sub_step * 100
                    )}%\x1b[0m\n`
                );

                for (const [component, logs] of Object.entries(
                    message.data.logs
                )) {
                    console.log(
                        `\x1b[33m\x1b[1mComponent: ${component}\x1b[0m`
                    );
                    console.log(logs);
                }

                if (message.data.is_done) {
                    clearTimeout(timeoutId);
                    socket.close();
                    resolve(message.data.status === "success");
                }
            }
        });

        socket.on("error", function error(err) {
            reject(err);
        });
    });
}

module.exports = deploy;
