const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class FileManager {
    constructor() {
        this.baseDir = path.join(__dirname, '..', 'uploads');
        this.metadataPath = path.join(this.baseDir, 'metadata.json');
        this.init();
    }

    init() {
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
        if (!fs.existsSync(this.metadataPath)) {
            fs.writeFileSync(this.metadataPath, JSON.stringify({ files: {} }));
        }
    }

    getMetadata() {
        try {
            return JSON.parse(fs.readFileSync(this.metadataPath, 'utf8'));
        } catch (e) {
            return { files: {} };
        }
    }

    saveMetadata(metadata) {
        fs.writeFileSync(this.metadataPath, JSON.stringify(metadata, null, 2));
    }

    async saveFile(fileBuffer, originalName, purpose = 'user_data') {
        const id = `file-${crypto.randomBytes(8).toString('hex')}`;
        const fileName = `${id}-${originalName}`;
        const filePath = path.join(this.baseDir, fileName);

        fs.writeFileSync(filePath, fileBuffer);

        const metadata = this.getMetadata();
        const fileObj = {
            id,
            object: 'file',
            bytes: fileBuffer.length,
            created_at: Math.floor(Date.now() / 1000),
            filename: originalName,
            purpose,
            local_path: filePath
        };

        metadata.files[id] = fileObj;
        this.saveMetadata(metadata);

        return fileObj;
    }

    listFiles() {
        const metadata = this.getMetadata();
        return Object.values(metadata.files).map(({ local_path, ...rest }) => rest);
    }

    getFilePath(id) {
        const metadata = this.getMetadata();
        return metadata.files[id]?.local_path || null;
    }

    deleteFile(id) {
        const metadata = this.getMetadata();
        const file = metadata.files[id];
        if (file) {
            if (fs.existsSync(file.local_path)) {
                fs.unlinkSync(file.local_path);
            }
            delete metadata.files[id];
            this.saveMetadata(metadata);
            return true;
        }
        return false;
    }
}

module.exports = new FileManager();
