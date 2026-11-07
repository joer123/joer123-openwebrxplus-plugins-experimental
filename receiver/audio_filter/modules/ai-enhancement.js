(function (root) {
    'use strict';

    function createRnnoiseWorkerController() {
        const RN_VAD_THRESHOLD = 0.3;
        let worker = null;
        let nextId = 1;
        const pending = new Map();

        function workerSource() {
            return `
                'use strict';
                let rn = null;
                const RNNOISE_FRAME = 480;
                self.onmessage = async function (event) {
                    const data = event.data;
                    try {
                        if (data.type === 'init-rnnoise') {
                            const module = await import(data.basePath + 'rnnoise-sync.js');
                            const Module = module.default();
                            const statePtr = Module._rnnoise_create(0);
                            rn = {
                                module: Module,
                                statePtr,
                                inPtr: Module._malloc(RNNOISE_FRAME * 4),
                                outPtr: Module._malloc(RNNOISE_FRAME * 4)
                            };
                            self.postMessage({ type: 'ready', id: data.id });
                        } else if (data.type === 'process-rnnoise') {
                            const heap = rn.module.HEAPF32;
                            const inBase = rn.inPtr / 4;
                            const outBase = rn.outPtr / 4;
                            const frame = data.frame;
                            if (frame.length !== RNNOISE_FRAME) {
                                throw new RangeError('RNNoise requires exactly ' + RNNOISE_FRAME + ' samples per frame');
                            }
                            for (let i = 0; i < frame.length; i++) heap[inBase + i] = frame[i] * 32768;
                            const vadProbability = rn.module._rnnoise_process_frame(rn.statePtr, rn.outPtr, rn.inPtr);
                            const output = new Float32Array(frame.length);
                            for (let i = 0; i < frame.length; i++) output[i] = heap[outBase + i] / 32768;
                            self.postMessage({ type: 'result', id: data.id, frame: output, vadProbability: vadProbability }, [output.buffer]);
                        }
                    } catch (error) {
                        self.postMessage({ type: 'error', id: data.id, message: (error && error.message) || String(error) });
                    }
                };
            `;
        }

        function getWorker() {
            if (worker) return worker;
            const url = URL.createObjectURL(new Blob([workerSource()], { type: 'application/javascript' }));
            worker = new Worker(url);
            worker.onmessage = function (event) {
                const data = event.data;
                const request = pending.get(data.id);
                if (!request) return;
                pending.delete(data.id);
                if (data.type === 'error') request.reject(new Error(data.message));
                else request.resolve(data);
            };
            worker.onerror = function (event) {
                console.error('[audio_filter] AI worker error:', event.message || event);
            };
            return worker;
        }

        function request(message, transfer) {
            return new Promise(function (resolve, reject) {
                const activeWorker = getWorker();
                const id = nextId++;
                pending.set(id, { resolve: resolve, reject: reject });
                activeWorker.postMessage(Object.assign({ id: id }, message), transfer || []);
            });
        }

        async function processHop(state, hop) {
            let peak = 0;
            for (let i = 0; i < hop.length; i++) peak = Math.max(peak, Math.abs(hop[i]));
            if (peak > state.aiEnvelope) state.aiEnvelope = state.aiEnvelope * 0.6 + peak * 0.4;
            else state.aiEnvelope = state.aiEnvelope * 0.85 + peak * 0.15;
            state.aiEnvelope = Math.max(state.aiEnvelope, 0.0005);

            if (state.rnVadProbability >= RN_VAD_THRESHOLD) state.rnVadHangFrames = 1;
            else state.rnVadHangFrames = Math.max(0, (state.rnVadHangFrames || 0) - 1);
            let targetGain = state.rnVadHangFrames > 0 ? state.rnTarget / state.aiEnvelope : 1;
            targetGain = Math.max(1, Math.min(targetGain, state.rnMaxBoost));
            const startGain = state.aiLastGain;
            const frame = new Float32Array(hop.length);
            for (let i = 0; i < hop.length; i++) {
                frame[i] = hop[i] * (startGain + (targetGain - startGain) * (i / hop.length));
            }
            state.aiLastGain = targetGain;

            const result = await request({ type: 'process-rnnoise', frame: frame }, [frame.buffer]);
            const processed = result.frame;
            state.rnVadProbability = Number.isFinite(result.vadProbability) ? result.vadProbability : 0;
            const delayedDry = state.rnDry.splice(0, hop.length);
            while (delayedDry.length < hop.length) delayedDry.push(0);
            for (let i = 0; i < hop.length; i++) state.rnDry.push(hop[i]);

            const output = new Float32Array(processed.length);
            for (let i = 0; i < processed.length; i++) {
                const gain = startGain + (targetGain - startGain) * (i / hop.length);
                output[i] = (processed[i] / gain) * state.rnWetMix + delayedDry[i] * (1 - state.rnWetMix);
            }
            return output;
        }

        return { request: request, processHop: processHop };
    }

    root.AudioFilterModules = root.AudioFilterModules || {};
    root.AudioFilterModules.aiEnhancement = { createRnnoiseWorkerController: createRnnoiseWorkerController };
})(window);
