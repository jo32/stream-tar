# Tar file readable stream to multiple file stream

Usage:

    var tfse = new TarFileStreamEmitter(rs);
    tse.on("file", function(fileInfo, fileStream) {
        fileStream.pipe(blobStream()).on('finish', function() {
            var blob = this.toBlob();
            saveAs(blob, fileInfo.fileName);
        });
    });
    tse.on("end", function() {
        console.log("end");
    });