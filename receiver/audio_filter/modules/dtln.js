(function (root) {
    'use strict';

    async function processHop(dtln, hop, dependencies) {
        const blockSize = dependencies.blockSize;
        const hopSize = dependencies.hopSize;
        const real = dependencies.real;
        const imag = dependencies.imag;
        const magnitude = dependencies.magnitude;
        const phase = dependencies.phase;
        const fft = dependencies.fft;
        const ort = dependencies.ort;

        dtln.winBuf.copyWithin(0, hopSize, blockSize);
        for (let i = 0; i < hopSize; i++) dtln.winBuf[blockSize - hopSize + i] = hop[i];

        real.set(dtln.winBuf);
        imag.fill(0);
        fft(real, imag, false);
        for (let k = 0; k <= blockSize / 2; k++) {
            magnitude[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
            phase[k] = Math.atan2(imag[k], real[k]);
        }

        const result1 = await dtln.session1.run({
            input_2: new ort.Tensor('float32', magnitude, [1, 1, blockSize / 2 + 1]),
            input_3: new ort.Tensor('float32', dtln.state1, [1, 2, 128, 2])
        });
        const mask = result1.activation_2.data;
        dtln.state1 = Float32Array.from(result1.tf_op_layer_stack_2.data);

        for (let k = 0; k <= blockSize / 2; k++) {
            const maskedMagnitude = magnitude[k] * Math.max(mask[k], dtln.maskFloor);
            real[k] = maskedMagnitude * Math.cos(phase[k]);
            imag[k] = maskedMagnitude * Math.sin(phase[k]);
            if (k > 0 && k < blockSize / 2) {
                real[blockSize - k] = real[k];
                imag[blockSize - k] = -imag[k];
            }
        }
        fft(real, imag, true);

        const result2 = await dtln.session2.run({
            input_4: new ort.Tensor('float32', real.slice(0, blockSize), [1, 1, blockSize]),
            input_5: new ort.Tensor('float32', dtln.state2, [1, 2, 128, 2])
        });
        const outputBlock = result2.conv1d_3.data;
        dtln.state2 = Float32Array.from(result2.tf_op_layer_stack_5.data);

        dtln.outBuf.copyWithin(0, hopSize, blockSize);
        dtln.outBuf.fill(0, blockSize - hopSize);
        for (let i = 0; i < blockSize; i++) dtln.outBuf[i] += outputBlock[i];

        const delayedDry = dtln.dryDelay.splice(0, hopSize);
        for (let i = 0; i < hopSize; i++) dtln.dryDelay.push(hop[i]);
        for (let i = 0; i < hopSize; i++) {
            dtln.pendingOut16k.push(dtln.outBuf[i] * dtln.wetMix + delayedDry[i] * (1 - dtln.wetMix));
        }
    }

    root.AudioFilterModules = root.AudioFilterModules || {};
    root.AudioFilterModules.dtln = { processHop: processHop };
})(window);
