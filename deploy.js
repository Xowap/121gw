const fs = require("node:fs");
const ws = require("ws");
const core = require("@actions/core");
const colors = require("colors");

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

/**
 * Displays a progress bar with a label.
 *
 * @param label
 * @param progress
 */
function displayProgressBar(label, progress) {
    console.log(
        colors.blue.bold(label.padEnd(20, " ") + ":") +
            colors.green(
                `${createProgressBar(progress)} ${Math.round(progress * 100)}%`
            )
    );
}

/**
 * Displays a header with a text.
 *
 * @param level Level 1 is a big header and level 2 is a smaller one
 * @param text Text to put in the header
 */
function displayHeader(level, text) {
    const level1Chars = ["┏", "━", "┗", "┃"];
    const level2Chars = ["╔", "═", "╚", "║"];
    const [startChar, lineChar, endChar, textChar] =
        level === 1 ? level1Chars : level2Chars;
    const colorFunc = level === 1 ? colors.yellow.bold : colors.cyan.bold;

    console.log("");
    console.log(colorFunc(` ${startChar}${lineChar.repeat(3)}`));
    console.log(colorFunc(` ${textChar} ${text}`));
    console.log(colorFunc(` ${endChar}${lineChar.repeat(3)}`));
    console.log("");
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

    function hookUpSocket() {
        const wsEndpoint = wsJoin(endpoint, "/back/ws/deploy/");
        socket = new ws(wsEndpoint);

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
            const message = JSON.parse(data);

            if (message.type === "update") {
                if (message.data.step !== lastStep) {
                    if (lastStep) {
                        core.endGroup();
                    }

                    core.startGroup(message.data.step);
                    displayHeader(1, message.data.step);
                    lastStep = message.data.step;
                }

                if (message.data.progress.step !== lastStepProgress) {
                    displayProgressBar(
                        "Step progress",
                        message.data.progress.step
                    );
                    lastStepProgress = message.data.progress.step;
                }

                if (message.data.progress.sub_step !== lastSubStepProgress) {
                    displayProgressBar(
                        "Sub-step progress",
                        message.data.progress.sub_step
                    );
                    lastSubStepProgress = message.data.progress.sub_step;
                }

                for (const [component, logs] of Object.entries(
                    message.data.logs
                )) {
                    const buf = Buffer.from(logs, "base64");
                    displayHeader(2, component);
                    fs.writeSync(process.stdout.fd, buf, 0, buf.length);
                }

                if (message.data.is_done) {
                    clearTimeout(timeoutId);
                    isDone = true;
                    socket.close();
                    socket = null;
                    resolve(message.data.status === "success");
                    core.endGroup();
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
