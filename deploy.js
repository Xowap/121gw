const fs = require("node:fs");
const ws = require("ws");
const core = require("@actions/core");
const { differenceInSeconds } = require("date-fns");

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
    let lastStep = "";
    let lastStepProgress = null;
    let lastSubStepProgress = null;
    let fluxfile = null;
    let timeoutId = null;
    let socket = null;
    let reject;
    let resolve;
    let deploymentId = null;
    let isDone = false;
    let lastUpdate = new Date();

    function hookUpSocket() {
        const wsEndpoint = wsJoin(endpoint, "/back/ws/deploy/");
        socket = new ws(wsEndpoint);

        const watchdog = setInterval(() => {
            if (differenceInSeconds(new Date(), lastUpdate) > 10) {
                console.log(
                    `\x1b[31m\x1b[1mWatchdog detected a stall, reconnecting\x1b[0m`
                );

                if (socket) {
                    socket.close();
                    socket = null;
                }

                clearInterval(watchdog);
                hookUpSocket();
            }
        });

        socket.on("open", function open() {
            if (!deploymentId) {
                socket.send(
                    JSON.stringify({
                        action: "deploy",
                        token,
                        branch,
                        fluxfile,
                    })
                );
            } else {
                socket.send(
                    JSON.stringify({
                        action: "follow",
                        token,
                        deployment_id: deploymentId,
                    })
                );
            }
        });

        socket.on("message", function incoming(data) {
            lastUpdate = new Date();
            const message = JSON.parse(data);

            if (message.type === "update") {
                if (message.data.step !== lastStep) {
                    core.startGroup(message.data.step);
                    lastStep = message.data.step;
                }

                if (message.data.progress.step !== lastStepProgress) {
                    console.log(
                        `\x1b[34m\x1b[1mStep progress:    \x1b[0m \x1b[32m${createProgressBar(
                            message.data.progress.step
                        )} ${Math.round(
                            message.data.progress.step * 100
                        )}%\x1b[0m`
                    );
                    lastStepProgress = message.data.progress.step;
                }

                if (message.data.progress.sub_step !== lastSubStepProgress) {
                    console.log(
                        `\x1b[34m\x1b[1mSub-step progress:\x1b[0m \x1b[32m${createProgressBar(
                            message.data.progress.sub_step
                        )} ${Math.round(
                            message.data.progress.sub_step * 100
                        )}%\x1b[0m`
                    );
                    lastSubStepProgress = message.data.progress.sub_step;
                }

                for (const [component, logs] of Object.entries(
                    message.data.logs
                )) {
                    const buf = Buffer.from(logs, "base64");
                    console.log(`\n\x1b[33m\x1b[1m ╓───\x1b[0m`);
                    console.log(
                        `\x1b[33m\x1b[1m ║ \x1b[0m\x1b[33mLogs for: \x1b[1m${component}\x1b[0m`
                    );
                    console.log(`\x1b[33m\x1b[1m ╙───\x1b[0m\n`);
                    fs.writeSync(process.stdout.fd, buf, 0, buf.length);
                }

                if (message.data.is_done) {
                    clearTimeout(timeoutId);
                    isDone = true;
                    socket.close();
                    socket = null;
                    resolve(message.data.status === "success");
                }
            } else if (message.type === "set_id") {
                deploymentId = message.data.deployment_id;
            }
        });

        socket.on("error", function error(err) {
            reject(err);
        });

        socket.on("close", function () {
            if (!isDone) {
                console.log(
                    `\x1b[31m\x1b[1mSocket closed, reconnecting\x1b[0m`
                );

                setTimeout(() => {
                    hookUpSocket();
                }, 1000);
            }
        });
    }

    return new Promise((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;

        timeoutId = setTimeout(() => {
            console.log(
                `\x1b[31m\x1b[1mTimeout after ${Math.round(
                    timeout / 60000
                )} minutes.\x1b[0m`
            );

            if (socket) {
                socket.close();
                socket = null;
            }

            reject(new Error("Timeout"));
        }, timeout * 1000);

        try {
            fluxfile = fs.readFileSync(file, "utf-8");
        } catch (e) {
            console.log(`\x1b[31m\x1b[1mError reading file ${file}.\x1b[0m`);
            return reject(e);
        }

        hookUpSocket();
    });
}

module.exports = deploy;
