var stream = require("stream");
var util = require("util");
var EventEmitter = require("events");

var BLOCK_SIZE = 512;

function trimZeroAndReturnSubArray(typedArray) {
    var startIndex = 0;
    while (typedArray[startIndex] && typedArray[startIndex] === 0) {
        startIndex += 1;
    }
    var endIndex = startIndex;
    while (typedArray[endIndex] && typedArray[endIndex] !== 0) {
        endIndex += 1;
    }
    return typedArray.subarray(startIndex, endIndex);
}

function isBlockAllZero(block) {
    var view = new Uint32Array(block);
    for (var i = 0; i < view.length; i++) {
        if (view[i] !== 0) {
            return false;
        }
    }
    return true;
}

function typedArrayToBuffer(typedArray) {
    return new Buffer(typedArray);
}

function getStringFromTypedArray(typedArray) {
    var trimedArray = trimZeroAndReturnSubArray(typedArray);
    return String.fromCharCode.apply(null, trimedArray);
}

function TarFileStreamEmitter(tarStream, opts) {
    if (!tarStream instanceof stream.Readable) {
        throw new Error("Tar stream given is not instance of stream.ReadableStream.");
    }
    EventEmitter.call(this);
    // this.tarStream = tarStream;
    // this.tarOffset = 0;

    opts = opts || {};
    this.chunkSize = opts.chunkSize || 512 * 1024; // default chunkSize to emit data of file in tar, which is 512 KB
    if (this.chunkSize < BLOCK_SIZE) {
        throw new Error("Chunksize cannot be smaller than BLOCK_SIZE: " + BLOCK_SIZE);
    }

    this.currentFileInfo = null;
    this.currentFileReadableStream = null;
    this.currentFileBuffer = null;
    this.isFileEnd = false;
    this.emptyBlockCount = 0;

    this.blockBuffer = null;
    tarStream.on('data', (function(buffer) {
        this.__onData(buffer);
    }).bind(this));
}

util.inherits(TarFileStreamEmitter, EventEmitter);

TarFileStreamEmitter.prototype.__clearCurrentFileInfo = function() {
    this.currentFileInfo = null;
    this.currentFileReadableStream = null;
    this.currentFileBuffer = null;
}

TarFileStreamEmitter.prototype.__onData = function(buffer) {
    if (!buffer instanceof Buffer) {
        throw new Error("buffer is not instance of Buffer");
    }

    // ensuring each block is no larger than BLOCK_SIZE
    for (var i = 0; i < buffer.byteLength / BLOCK_SIZE + 1; i++) {
        this.__pushTarBuffer(buffer.subarray(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE))
    }

}

TarFileStreamEmitter.prototype.__pushTarBuffer = function(buffer) {

    if (buffer.byteLength > BLOCK_SIZE) {
        throw new Error("Size of buffer should not exceed BLOCK_SIZE: " + BLOCK_SIZE);
    }

    if (buffer.byteLength == BLOCK_SIZE && !this.blockBuffer) {
        this.__proccessBlock(buffer);
        return;
    }
}

TarFileStreamEmitter.prototype.__pushFileBuffer = function(blockBuffer) {
    // finish of file
    if (blockBuffer == null && this.currentFileBuffer) {
        if (this.currentFileBufferLength > 0) {
            this.currentFileReadableStream.push(typedArrayToBuffer(this.currentFileBuffer.subarray(0, this.currentFileBufferLength)));
        }
        this.currentFileBufferLength = 0;
        this.currentFileReadableStream.push(null);
        return;
    }

    if (!this.currentFileBuffer) {
        this.currentFileBuffer = new Uint8Array(this.chunkSize * 2);
        this.currentFileBufferLength = 0;
    }

    this.currentFileBuffer.set(new Uint8Array(blockBuffer), this.currentFileBufferLength);
    this.currentFileBufferLength += blockBuffer.byteLength;

    if (this.currentFileBufferLength >= this.chunkSize) {
        this.currentFileReadableStream.push(typedArrayToBuffer(this.currentFileBuffer.subarray(0, this.chunkSize)));
        this.currentFileBuffer.set(this.currentFileBuffer.subarray(this.chunkSize, this.this.currentFileBufferLength))
        this.currentFileBufferLength = this.currentFileBufferLength - this.chunkSize;
    }
}

// proccess each block
TarFileStreamEmitter.prototype.__proccessBlock = function(blockBuffer) {

    if (this.isFileEnd) {
        if (isBlockAllZero(blockBuffer)) {
            this.emptyBlockCount += 1;
            if (this.emptyBlockCount >= 2) {
                this.emit("end");
            }
            return;
        }
    }

    // it is the first block of file (header block, which is 512 Bytes long)
    if (!this.currentFileReadableStream) {
        this.currentFileReadableStream = new PushableReadableStream();
        this.currentFileInfo = this.__getFileInfoFromHeaderBlock(blockBuffer);
        this.emit("file", this.currentFileInfo, this.currentFileReadableStream);
        this.currentFileInfo.readSize = 0;
        this.isFileEnd = false;
        return;
    }

    // if it is not the first block of file
    if (this.currentFileInfo.readSize + blockBuffer.byteLength >= this.currentFileInfo.fileSize) {
        var trimedBuffer = typedArrayToBuffer(trimZeroAndReturnSubArray(new Uint8Array(blockBuffer)));
        this.__pushFileBuffer(trimedBuffer);
        this.currentFileInfo.readSize += trimedBuffer.byteLength;
    } else {
        this.__pushFileBuffer(blockBuffer);
        this.currentFileInfo.readSize += blockBuffer.byteLength;
    }

    if (this.currentFileInfo.readSize >= this.currentFileInfo.fileSize) {
        this.__pushFileBuffer(null);
        this.__clearCurrentFileInfo();
        this.isFileEnd = true;
        this.emptyBlockCount = 0;
    }
}

TarFileStreamEmitter.prototype.__getFileInfoFromHeaderBlock = function(headerBlockBuffer) {
    
    var view = new Uint8Array(headerBlockBuffer);
    var fileName = getStringFromTypedArray(view.subarray(0, 0 + 100));
    var fileSize = parseInt(getStringFromTypedArray(view.subarray(124, 124 + 12)), 8);
    return {
        fileName: fileName,
        fileSize: fileSize
    };
}

function PushableReadableStream() {
    stream.Readable.call(this);
}

util.inherits(PushableReadableStream, stream.Readable);

PushableReadableStream.prototype._read = function() {
    return;
}

module.exports = TarFileStreamEmitter;