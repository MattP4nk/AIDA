var prompt;
var currentServer;
var currentDirectory;
var user = null;
var io = {};
var commands = {};
var argumentCommands = {};
var commandList = [];
var servers = [];
var access = false;
//is called when the page loads
function init() {
	io.input = document.getElementById("input");
	io.output = document.getElementById("output");
	io.prompt = document.getElementById("prompt");
	print(welcomeMessage);
	setPrompt();
	focusInput();
}

//is called when user presses enter, this is where the main stuff happens
function handleInput(aEvent) {
	if (aEvent.keyCode === 13) {
		aEvent.preventDefault();
		print(prompt + io.input.value);
		const input = io.input.value.toLowerCase();
		io.input.value = "";
		if (input !== "") {
			if (input in commands) {
				commands[input]();
			} else {
				let spaceIndex = input.indexOf(" ");
				let command = input;
				if (spaceIndex > 0) {
					command = input.substring(0, spaceIndex);
				}
				if (command in argumentCommands) {
					argumentCommands[command](input);
				} else {
					print("Command not found\nType 'help' for a list of commands");
				}
			}
		}
		window.scrollTo(0, document.body.scrollHeight);
	}
}

//creates a command
function createCommand(aName, aDescription, aFunction) {
	commands[aName] = aFunction;
	if (aDescription) {
		commandList.push(aName + " - " + aDescription);
	}
}

//creates a command that takes an argument
function createArgumentCommand(aName, aDescription, aFunction) {
	argumentCommands[aName] = aFunction;
	if (aDescription) {
		commandList.push(aName + " - " + aDescription);
	}
}

//prints a string and makes sure newline characters are handled correctly
function print(aString) {
	var output = document.createElement("p");
	var text;
	var newlineIndex = aString.indexOf("\n");
	while (newlineIndex >= 0) {
		text = document.createTextNode(aString.substring(0, newlineIndex));
		output.appendChild(text);
		var newline = document.createElement("br");
		output.appendChild(newline);
		aString = aString.substring(newlineIndex + 1, aString.length);
		newlineIndex = aString.indexOf("\n");
	}
	text = document.createTextNode(aString);
	output.appendChild(text);
	io.output.appendChild(output);
}

//gets a random number in the range [0, aMax)
function random(aMax) {
	return Math.floor(Math.random() * aMax);
}

//gives focus to the input field
function focusInput() {
	io.input.focus();
}

//set network access
function setAccess(){
	if (user !== null){
		access = true;
	}
}

//sets the user name
function setUser(userName) {
	print("SCANNING IRIS...\nSAVING NEW IDENTIFICATORS...\nDONE")
	user = userName
	print("New user registered, welcome to the Neurolink Network: " + user);
	setAccess();
	setPrompt();
}

function lineDivider(line){
	let part1 = "";
	let part2 = "";
	let divided = false;
	for (let char of line){
		if (divided == false){
			if (char !== " "){
				part1 += char;
			}else{
				divided = true;
			}
		}else{
			part2 += char;
		}
	}
	return [part1, part2];
}

//sets the prompt to show the current directory
function setPrompt() {
	if (user == null){
		prompt =  "Guest " + currentDirectory.getName() + "$ ";
	}else{
		prompt =  user + " " + currentDirectory.getName() + "$ ";
	}
	io.prompt.innerHTML = prompt;
	io.input.style.width = (document.body.offsetWidth - io.prompt.offsetWidth * 1.2) + "px";
}

