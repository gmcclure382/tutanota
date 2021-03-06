"use strict";

describe("AesArrayBufferTest", function () {

    var assert = chai.assert;

    var _getFacade = function () {
        return tutao.locator.crypto;
    };

    var _arrayRoundtrip = function (key, plainText) {
        var facade = _getFacade();
        return facade.aesEncrypt(key, plainText).then(function(encrypted) {
            return facade.aesDecrypt(key, encrypted, plainText.length).then(function(decrypted) {
                assert.deepEqual(plainText, decrypted);
            });
        });
    };

    var _encryptArrayBuffer = function (key, iv, arrayBuffer, callback) {
        var facade = new tutao.crypto.SjclAes();

        // encrypt array buffer
        facade._encryptArrayBuffer(key, arrayBuffer, iv, function (encrypted, exception) {
            assert.isUndefined(exception);
            var encryptedConvertedBits = _arrayBufferToBitArray(encrypted);
            // encrypt as bitArray
            var words = _arrayBufferToBitArray(arrayBuffer);
            var encryptedBits = sjcl.bitArray.concat(iv, sjcl.mode.cbc.encrypt(new sjcl.cipher.aes(key), words, iv, [], true));

            // check equality of enrypted array buffer and bitArray
            assert.deepEqual(encryptedBits, encryptedConvertedBits);
            callback();
        });
    };

    var _bitArrayToArrayBuffer = function (arr) {
        var bl = sjcl.bitArray.bitLength(arr) / 8;
        var arrayBuffer = new ArrayBuffer(bl);
        var out = new Uint8Array(arrayBuffer);
        var tmp;
        for (var i = 0; i < bl; i++) {
            if ((i & 3) === 0) {
                tmp = arr[i / 4];
            }
            out[i] = (tmp >>> 24);
            tmp <<= 8;
        }
        return arrayBuffer;
    };

    var _arrayBufferToBitArray = function (arrayBuffer) {
        var bytes = new Uint8Array(arrayBuffer);
        var out = [];
        var i;
        var tmp = 0;
        for (i = 0; i < bytes.length; i++) {
            tmp = tmp << 8 | bytes[i];
            if ((i & 3) === 3) {
                out.push(tmp);
                tmp = 0;
            }
        }
        if (i & 3) {
            out.push(sjcl.bitArray.partial(8 * (i & 3), tmp));
        }
        return out;
    };

    var _createArray = function (len) {
        var view = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            view[i] = tutao.util.EncodingConverter.hexToBytes(tutao.locator.randomizer.generateRandomData(1));
        }
        return view;
    };

    var _getEncryptedArrayBuffer = function (key, bufferLen) {
        var facade = tutao.locator.crypto;
        var arrayBuffer = _createArray(bufferLen);
        return facade.aesEncrypt(key, arrayBuffer);
    };

    var _base64Roundtrip = function (facade, key, plainText) {
        var unencryptedBits = _arrayBufferToBitArray(plainText);
        var unencryptedBytes = sjcl.codec.bytes.fromBits(unencryptedBits);
        var unencryptedBase64 = sjcl.codec.base64.fromBits(unencryptedBits);
        return facade.aesEncrypt(key, plainText).then(function (encrypted) {
            var encryptedBase64 = sjcl.codec.base64.fromBits(_arrayBufferToBitArray(encrypted));
            var oldFacade = new tutao.crypto.SjclAes();
            return oldFacade.decryptBase64(oldFacade.hexToKey(tutao.util.EncodingConverter.bytesToHex(key)), encryptedBase64, plainText.length).then(function (decryptedBase64) {
                assert.equal(unencryptedBase64, decryptedBase64);
            });
        });
    };


    it("ArrayRoundtrip ", function () {
        this.timeout(24000);

        var facade = _getFacade();
        var key = facade.generateAesKey();
        return _arrayRoundtrip(key, _createArray(0)).then(function () {
            return _arrayRoundtrip(key, _createArray(1)).then(function () {
                return _arrayRoundtrip(key, _createArray(15)).then(function () {
                    return _arrayRoundtrip(key, _createArray(16)).then(function () {
                        return _arrayRoundtrip(key, _createArray(17)).then(function () {
                            return _arrayRoundtrip(key, _createArray(12345));
                        });
                    });
                });
            });
        });
    });

    it("ArrayBufferImplementationCompatibility ", function () {
        var plainText = new Uint8Array([3, 240, 19]);
        var key = new Uint8Array([181, 50, 148, 196, 166, 19, 212, 184, 249, 95, 122, 48, 226, 175, 32, 189]);
        var cipherText = new Uint8Array([255, 223, 151, 34, 157, 32, 197, 116, 80, 245, 27, 255, 230, 26, 233, 238, 179, 27, 47, 148, 75, 41, 233, 210, 185, 108, 45, 109, 3, 227, 75, 10]);
        var facade = tutao.locator.crypto;
        return facade.aesDecrypt(key, cipherText, plainText.length).then(function (decrypted) {
            assert.deepEqual(plainText, decrypted);
        });
    });

    it("Android decrypt file compatibility", function () {
        // only run on android
        if (typeof cordova == 'undefined' || cordova.platformId != 'android') {
            return;
        }
        var plainText = new Uint8Array([3, 240, 19]);
        var key = new Uint8Array([181, 50, 148, 196, 166, 19, 212, 184, 249, 95, 122, 48, 226, 175, 32, 189]);
        var cipherText = new Uint8Array([255, 223, 151, 34, 157, 32, 197, 116, 80, 245, 27, 255, 230, 26, 233, 238, 179, 27, 47, 148, 75, 41, 233, 210, 185, 108, 45, 109, 3, 227, 75, 10]);

        var fileUtil = new tutao.native.device.FileUtil();
        var file = cordova.file.dataDirectory + "test/encrypted.bin";

        var facade = tutao.locator.crypto;
        return fileUtil.write(file, cipherText).then(function () {
            return facade.aesDecryptFile(key, file);
        }).then(function (decryptedFile) {
            return fileUtil.read(decryptedFile);
        }).then(function (fileContents) {
            assert.deepEqual(fileContents, plainText);
        });
    });

    it("android file roundtrip", function () {
        // only run on android
        if (typeof cordova == 'undefined' || cordova.platformId != 'android') {
            return;
        }
        var plainText = new Uint8Array([3, 240, 19]);
        var key = new Uint8Array([181, 50, 148, 196, 166, 19, 212, 184, 249, 95, 122, 48, 226, 175, 32, 189]);

        var fileUtil = new tutao.native.device.FileUtil();
        var file = cordova.file.dataDirectory + "test/plain.bin";

        var facade = tutao.locator.crypto;
        return fileUtil.write(file, plainText).then(function () {
            return facade.aesEncryptFile(key, file);
        }).then(function (encryptedFile) {
            return facade.aesDecryptFile(key, encryptedFile);
        }).then(function (decryptedFile) {
            return fileUtil.read(decryptedFile);
        }).then(function (fileContents) {
            assert.deepEqual(fileContents, plainText);
        });
    });

    it("EncryptInvalidKey ", function () {
        var facade = tutao.locator.crypto;
        var key = new Uint8Array([1, 2, 3]);
        var arrayBuffer = _createArray(10);

        return assert.isRejected(facade.aesEncrypt(key, arrayBuffer), tutao.crypto.CryptoError);
    });

    it("DecryptInvalidKey ", function () {
        var facade = tutao.locator.crypto;
        var key = new Uint8Array([1, 2, 3]);
        var arrayBuffer = _createArray(10);

        return assert.isRejected(facade.aesDecrypt(key, arrayBuffer, 10), tutao.crypto.CryptoError);
    });

    it("DecryptInvalidSrcBufferLen ", function () {
        var facade = tutao.locator.crypto;
        var key = facade.generateAesKey();
        var encrypted = _createArray(33); // 33 is no valid encrypted size

        return assert.isRejected(facade.aesDecrypt(key, encrypted, 2), tutao.crypto.CryptoError);
    });

    it("DecryptInvalidDstBufferLen ", function () {
        var facade = tutao.locator.crypto;
        var key = facade.generateAesKey();
        var encrypted = _createArray(48); // encrypted 48 bytes it too big for 4 plain text bytes

        return assert.isRejected(facade.aesDecrypt(key, encrypted, 4), tutao.crypto.CryptoError);
    });

    it("DecryptInvalidEncrypted ", function () {
        var facade = tutao.locator.crypto;
        var key = facade.generateAesKey();
        return _getEncryptedArrayBuffer(key, 10).then(function (encrypted) {
            // change the last byte
            encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1] + 1;
            return assert.isRejected(facade.aesDecrypt(key, encrypted, 10), tutao.crypto.CryptoError);
        });
    });

    it("DecryptInvalidDecryptedSize ", function () {
        var facade = tutao.locator.crypto;
        var key = facade.generateAesKey();
        return _getEncryptedArrayBuffer(key, 10).then(function (encrypted) {
            // use 11 instead of 10
            return assert.isRejected(facade.aesDecrypt(key, encrypted, 11), tutao.crypto.CryptoError);
        });
    });

    it("ByteTo32BitRoundtrip ", function () {
        var facade = _getFacade();
        assert.deepEqual([0], sjcl.codec.bytes.toBits([0, 0, 0, 0]));
        assert.deepEqual([255], sjcl.codec.bytes.toBits([0, 0, 0, 255]));
        assert.deepEqual([256], sjcl.codec.bytes.toBits([0, 0, 1, 0]));
        assert.deepEqual([256 * 256], sjcl.codec.bytes.toBits([0, 1, 0, 0]));
        assert.deepEqual([256 * 256 * 256], sjcl.codec.bytes.toBits([1, 0, 0, 0]));
        assert.deepEqual([(256 * 256 * 256 * 128) - 1], sjcl.codec.bytes.toBits([127, 255, 255, 255]));
        assert.deepEqual([-(256 * 256 * 256 * 128)], sjcl.codec.bytes.toBits([128, 0, 0, 0]));
        assert.deepEqual([-1], sjcl.codec.bytes.toBits([255, 255, 255, 255]));

        assert.deepEqual([0, 0, 0, 0], sjcl.codec.bytes.fromBits([0]));
        assert.deepEqual([0, 0, 0, 255], sjcl.codec.bytes.fromBits([255]));
        assert.deepEqual([0, 0, 1, 0], sjcl.codec.bytes.fromBits([256]));
        assert.deepEqual([0, 1, 0, 0], sjcl.codec.bytes.fromBits([256 * 256]));
        assert.deepEqual([1, 0, 0, 0], sjcl.codec.bytes.fromBits([256 * 256 * 256]));
        assert.deepEqual([127, 255, 255, 255], sjcl.codec.bytes.fromBits([(256 * 256 * 256 * 128) - 1]));
        assert.deepEqual([128, 0, 0, 0], sjcl.codec.bytes.fromBits([-(256 * 256 * 256 * 128)]));
        assert.deepEqual([255, 255, 255, 255], sjcl.codec.bytes.fromBits([-1]));

    });

    it("DecryptBase64InvalidBase64 ", function () {
        var facade = new tutao.crypto.SjclAes();
        var key = facade.generateRandomKey();
        return assert.isRejected(facade.decryptBase64(key, "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh&=", 6), /error during base64 decryption, original message: this isn't base64!/);
    });

    it("DecryptBase64InvalidKey ", function () {
        var facade = new tutao.crypto.SjclAes();
        return assert.isRejected(facade.decryptBase64([1, 2], "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", 6), /invalid key length: 64/);
    });

    it("DecryptBase64InvalidSrcBuffer ", function () {
        var facade = new tutao.crypto.SjclAes();
        var key = facade.generateRandomKey();
        return assert.isRejected(facade.decryptBase64(key, "AAECA", 6), /invalid src buffer len: 3.75/);
    });

    it("DecryptBase64TooSmallSrcBuffer ", function () {
        var facade = new tutao.crypto.SjclAes();
        var key = facade.generateRandomKey();
        return assert.isRejected(facade.decryptBase64(key, "AAECAwQFBgcICQoLDA0ODA==", 6), /invalid src buffer len: 16/);
    });

    it("DecryptBase64InvalidPadding ", function () {
        var facade = new tutao.crypto.SjclAes();
        var key = facade.hexToKey("a8db9ef70c44dc8acce26e9f44ca2f37"); // use a fixed key here to avoid that the padding value might accidentally be correct
        return assert.isRejected(facade.decryptBase64(key, "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", 17), /invalid padding value: 243/);
    });

    it("DecryptBase64InvalidDecryptedSize ", function () {
        var facade = new tutao.crypto.SjclAes();
        var key = tutao.locator.crypto.generateAesKey();
        return tutao.locator.crypto.aesEncrypt(key, _createArray(64)).then(function (encrypted) {
            var encryptedBase64 = sjcl.codec.base64.fromBits(_arrayBufferToBitArray(encrypted));
            return assert.isRejected(facade.decryptBase64(facade.hexToKey(tutao.util.EncodingConverter.bytesToHex(key)), encryptedBase64, 65), /invalid decrypted size: 65, expected: 64/);
        });
    });

    it("DecryptBase64InvalidDstLen ", function () {
        var facade = new tutao.crypto.SjclAes();
        var key = tutao.locator.crypto.generateAesKey();
        return tutao.locator.crypto.aesEncrypt(key, _createArray(64)).then(function (encrypted) {
            var encryptedBase64 = sjcl.codec.base64.fromBits(_arrayBufferToBitArray(encrypted));
            return assert.isRejected(facade.decryptBase64(facade.hexToKey(tutao.util.EncodingConverter.bytesToHex(key)), encryptedBase64, 63), /invalid dst buffer len: 63, src buffer len: 96/);
        });
    });

    it("DecryptBase64Roundtrip ", function () {
        this.timeout(60000);

        var facade = tutao.locator.crypto;
        var key = facade.generateAesKey();
        return _base64Roundtrip(facade, key, _createArray(0)).then(function () {
            return _base64Roundtrip(facade, key, _createArray(1));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(15));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(16));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(17));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(31));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(32));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(32));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(33));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(33));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(33));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(63));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(64));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(12345));
        }).then(function () {
            return _base64Roundtrip(facade, key, _createArray(120 * 1024)); // more than 100 KB to test the stTimeout
        });

    });
});