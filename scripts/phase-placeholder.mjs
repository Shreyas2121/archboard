const [commandName, implementationCommit] = process.argv.slice(2);

if (!commandName || !implementationCommit) {
  throw new Error('A placeholder command name and implementation commit are required.');
}

console.log(`${commandName} is reserved and will be implemented by ${implementationCommit}.`);
