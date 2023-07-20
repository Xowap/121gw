function runBefore(timeout, promise) {
    return new Promise((resolve, reject) => {
        promise.then(resolve, reject);

        setTimeout(() => {
            reject(new Error("Timeout"));
        }, timeout);
    });
}

module.exports = {
    runBefore,
};
