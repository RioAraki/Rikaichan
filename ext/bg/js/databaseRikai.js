/**
 * Created by Kalamandea on 04.09.2017.
 */

/**
 * DatabaseRikaichan loads the dictionary file (https://drive.google.com/drive/folders/0BwVl0WUbZr5QQkpEdV9YS1RYNDg) to cache?
 */


class DatabaseRikaichan {
    constructor() {
        this.dbList = {};
        this.dbVersion = 2;
        this.findWord = this.findWord.bind(this);
        this.importDictionary = this.importDictionary.bind(this);
    }

    /**
     * Dexie is a wrapper library for indexDB, a DB for browser
     * @param {*} name name of the dictionary?
     */
    sanitize(name) {
        const db = new Dexie(name);
        return db.open().then(() => {
            db.close();
            if (db.verno !== this.dbVersion) {
                return db.delete();
            }
        }).catch(() => {});
    }

    /**
     * Prepare the dictionary
     * @param {*} name  name of the dictionary
     */    
    prepare(name) {
        if (name == null) {
            return Promise.reject('Unknown title');
        }

        return this.sanitize(name).then(() => {
            this.dbList[name] = new Dexie(name);
            this.dbList[name].version(this.dbVersion).stores({
                terms: '++id,kanji,kana,entry'
            });

            return this.dbList[name].open();
        });
    }

    /**
     * delete the dictionary in case it is not initialized sucessfully
     * @param {*} name 
     */
    purge(name) {
        if (this.dbList[name] === null) {
            return Promise.reject('database' + name + ' not initialized');
        }

        this.dbList[name].close();
        return this.dbList[name].delete().then(() => {
            this.dbList[name] = null;
            //return this.prepare(name);
        });
    }

    /**
     * Looking for the words in dictionary
     * @param {*} term the words we are looking for  
     * @param {*} dic 
     */

    findWord(term, dic) {
        if (this.dbList[dic] == null) {
            return Promise.reject('database not initialized');
        }
        const results = [];
        // dic is already in dblist, if kanji or kana equals to the word we are looking for return result
        return this.dbList[dic].terms.where('kanji').equals(term).or('kana').equals(term).each(row => {
            results.push({
                kanji: row.kanji,
                kana: row.kana,
                entry: row.entry
            })
        }).then(() => {
            return results;
        });
    }

    /**
     * 
     * @param {*} archive 
     * @param {*} callback 
     */
    importDictionary(archive, callback) {
        let self = this;
        let summary = null;
        // index = index.json , entries = current dict bank, total = 
        const termsLoaded = (index, entries, total, current) => {
            const rows = [];
            let ch = 0;
            for (const line of entries) {
                ch++;
                rows.push({
                    kanji:line[0],
                    kana:line[1],
                    entry:line[2]
                });
                if (callback) {
                    callback(total, current);
                }
            }
            summary = Object.assign({},index);
            if(self.dbList[index.name]){
                return self.dbList[index.name].terms.bulkAdd(rows);
            }else{
                return self.prepare(index.name).then(()=> {
                    return self.dbList[index.name].terms.bulkAdd(rows);
                });
            }
        };

        return zipLoadDb(archive, termsLoaded).then(() => summary);
    }
}