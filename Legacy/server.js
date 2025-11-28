class Server {
	constructor(aName) {
		this.name = aName;
		this.entryLevel;
		this.known = false;
		this.encripted = false;
		this.path = (random(200) + "." + random(200) + "." + random(200) + "." + random(200))
	}
	setKnown(){
		this.known = true;
	}
	setEncription(){
		if (this.encripted == false){
			this.encripted = true;
		}
	}
	getPath() {
		return this.path;
	}
	getName() {
		return this.name;
	}

	getHome() {
		return this.entryLevel;
	}
	addHome(aHome) {
		const newHome = new Directory(aHome);
		this.entryLevel  = newHome;
	}
}