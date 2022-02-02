class textFile{
    constructor(aName){
        this.name = aName;
        this.content = ""
    }
    writeFile(text){
        this.content += ("---" + text + "\n");
    }
    readFile(){
        print(this.content);
    }

}