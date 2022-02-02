//Welcome message
const welcomeMessage = "Initializing NLT... \nSCANNING IRIS...\nNO MATCH FOUND...\nNETWORK ACCESS RESTRICTED";

//Current server and directory
currentServer = home_server;
currentDirectory = currentServer.getHome();

//User commands
createArgumentCommand("cd", "changes directory to specified directory", aInput => {
	if (aInput.length < 4) {
		print("No directory specified");
	} else {
		const path = aInput.substring(3, aInput.length);
		var newDirectory = currentDirectory.getDirectory(path);
		if (newDirectory !== null) {
			currentDirectory = newDirectory;
			setPrompt();
		} else {
			print(path + ": No such directory");
		}
	}
});	

createCommand("know_servers", "lists every server known", () => {
	if (access == false){
		print("Invalid action. You don't have access to the network");
	}else{
		servers.forEach(element => {
			if (element.known == true){
				print(element.getName() + " IP: " + element.getPath());
			}
		});
	}
});

createArgumentCommand("new_folder", "creates a new folder in the current directory", aInput => {
	if (aInput.length < 12){
		print("Invalid action. Please choose a valid name for the folder.");
	} else {
		const folder = aInput.substring(11, aInput.length);
		currentDirectory.addDirectory(new Directory (folder));
	}
});

createArgumentCommand("new_file", "creates a new text file in the current directory", aInput =>{
	if (aInput.length < 10){
		print("Invalid action. Please choose a valid name for the file.");
	} else {
		const file = aInput.substring(9, aInput.length);
		currentDirectory.addFile(new textFile (file), file);
	}
});

createCommand("ls", "lists directories and files in current directory", () => {
	print(currentDirectory.getList());
});

createArgumentCommand("new_user", "creates a new user for the system", aInput =>{
	if (aInput.length < 10){
		print("Invalid action. You must enter a valid user name");
	} else {
		const user = aInput.substring(9, aInput.length);
		setUser(user);
	}
});
createArgumentCommand("connect_to", "connects to a new server", aInput => {
	if (access == false){
		print("You don't have access to the network")
	}else{
		if (aInput.length < 12){
			print("Not valid IP address.");
		}else{
			const ip = aInput.substring(11, aInput.length);
			let connected = false;
			servers.forEach(element => {
				if (element.path == ip){
					currentServer = element;
					currentDirectory = element.getHome();
					print("You are now connected to " + element.name + " server. IP: " + element.getPath());
					setPrompt();
					connected = true;
				}
			});
			if (connected !== true){
				print("Not valid IP address.");
			}
		}
	}
});
createCommand("dir", null, commands.ls);

createArgumentCommand("write_in", "adds a new text line to the specified file", aInput => {
	if (aInput.length < 10) {
		print("No file specified");
	} else {
		const input = aInput.substring(9, aInput.length);
		let parts = lineDivider(input);
		let name = parts[0];
		let text = parts[1];
		let file = currentDirectory.getFile(name);
		if (typeof(file) === "object"){
			file.writeFile(text);
		}
	}
});

createArgumentCommand("open", "opens the specified file", aInput => {
	if (aInput.length < 6) {
		print("No file specified");
	} else {
		const name = aInput.substring(5, aInput.length);
		var file = currentDirectory.getFile(name);
		if (typeof(file) === "string") {
			window.open(file, "_blank");
		} else if (typeof(file) === "object"){
			file.readFile();
		} else {
			print(name + ": No such file");
		}
	}
});

createCommand("calculator", "opens the calculator app", () => {
	window.open("https://www.online-calculator.com/html5/online-calculator/index.php?v=10")
})

createArgumentCommand("search", "search the open network for a term", aInput => {
	var e = aInput.substring(7, aInput.length);
	var r = "https://www.google.com/search?q=";
	if (e !== "") {
		e = e.replace(/ /g, "+").trim();
		window.open(r + e);
	} else {
		print("enter a valid term for search.")
	}
})

createCommand("clear", "clears the console", () => {
	location.reload();
});

createCommand("xyzzy", null, () => {
	print("Nothing happens");
});

createCommand("help", "returns this list", () => {
	for (let index = 0; index < commandList.length; index++) {
		print(commandList[index]);
	}
});