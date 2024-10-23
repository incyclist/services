import fs from 'fs';

export async function loadFile(type, fileName) {
    return new Promise((resolve, reject) => {
        fs.readFile(fileName, {encoding:type}, (err, data) => {
            if (err)
                return reject(err);
            return resolve(data);
        });
    });
}
