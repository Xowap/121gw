const fs = require("node:fs");
const core = require("@actions/core");
const colors = require("colors");
const { PromSock } = require("./prom-sock");
const { runBefore } = require("./time");

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
    log(
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

    log("");
    log(colorFunc(` ${startChar}${lineChar.repeat(3)}`));
    log(colorFunc(` ${textChar} ${text}`));
    log(colorFunc(` ${endChar}${lineChar.repeat(3)}`));
    log("");
}

function readFluxFile(file) {
    return fs.readFileSync(file, "utf-8");
}

function makeYamlDoc(fluxfile, fileName) {
    const YAML = require("yaml");
    const YAMLSourceMap = require("yaml-source-map");

    const sourceMap = new YAMLSourceMap();
    const document = sourceMap.index(
        YAML.parseDocument(fluxfile, { keepCstNodes: true }),
        { filename: fileName }
    );

    return { sourceMap, document };
}

/**
 * Kind of a mock of log, but it writes directly to stdout (without
 * buffering).
 */
function log(...args) {
    const message = args.join(" ") + "\n";
    const buffer = Buffer.from(message);
    fs.writeSync(process.stdout.fd, buffer, 0, buffer.length);
}

class ProgressReporter {
    constructor() {
        this.lastStep = null;
        this.lastStepProgress = null;
        this.lastSubStepProgress = null;
        this.lastHeader = null;
    }

    report(msg) {
        if (this.lastStep !== msg.data.step) {
            if (this.lastStep) {
                core.endGroup();
            }

            core.startGroup(msg.data.step);
            displayHeader(1, msg.data.step);
            this.lastStep = msg.data.step;
        }

        if (msg.data.progress.step !== this.lastStepProgress) {
            displayProgressBar("Step progress", msg.data.progress.step);
            this.lastStepProgress = msg.data.progress.step;
        }

        if (msg.data.progress.sub_step !== this.lastSubStepProgress) {
            displayProgressBar("Sub-step progress", msg.data.progress.sub_step);
            this.lastSubStepProgress = msg.data.progress.sub_step;
        }

        for (const [component, logs] of Object.entries(msg.data.logs)) {
            if (this.lastHeader !== component) {
                displayHeader(2, component);
                this.lastHeader = component;
            }

            const buf = Buffer.from(logs, "base64");
            fs.writeSync(process.stdout.fd, buf, 0, buf.length);
        }
    }
}

function reportError(msg, fluxfile, fileName) {
    const { error, details } = msg;

    if (error) {
        log(colors.white.bgRed.bold(error));
    }

    if (details && details.length) {
        const { sourceMap, document } = makeYamlDoc(fluxfile, fileName);

        for (const { message, path } of details) {
            const loc = sourceMap.lookup(path, document);
            core.error(message, {
                title: "Fluxfile",
                startLine: loc.start.line,
                endLine: loc.end.line,
                startColumn: loc.start.col,
                endColumn: loc.end.col,
            });
        }
    }

    throw new Error(error || "Could not deploy");
}

async function innerDeploy({ endpoint, token, file, branch }) {
    const fluxfile = readFluxFile(file);

    let deploymentId = null;
    let cursors = null;

    const reporter = new ProgressReporter();
    const sock = new PromSock("/back/ws/deploy/", {
        baseUrl: endpoint,
        onRestore() {
            if (!deploymentId) {
                sock.send({
                    action: "deploy",
                    token,
                    branch,
                    fluxfile,
                });
            } else {
                sock.send({
                    action: "follow",
                    token,
                    deployment_id: deploymentId,
                    cursors,
                });
            }
        },
    });

    try {
        sock.connect();
        let msg;

        while ((msg = await sock.nextMessage())) {
            if (msg.type === "update") {
                reporter.report(msg);

                if (msg.data.cursors) {
                    cursors = msg.data.cursors;
                }

                if (msg.data.is_done) {
                    return;
                }
            } else if (msg.type === "set_id") {
                deploymentId = msg.data.deployment_id;
            } else if (msg.type === "error") {
                reportError(msg, fluxfile, file);
            }
        }
    } finally {
        sock.close();
    }
}

function deploy({ endpoint, token, file, branch, timeout }) {
    return runBefore(
        timeout * 1000,
        innerDeploy({ endpoint, token, file, branch })
    );
}

module.exports = deploy;
