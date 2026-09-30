export type SkillInvocation = {name: string; location: string; content: string; userMessage?: string};

export function parseSkillInvocation(text: string): SkillInvocation | null {
  const match = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/.exec(text);
  if (!match) return null;
  const [, name, location, content, userMessage] = match;
  if (name === undefined || location === undefined || content === undefined) return null;
  return {name, location, content, ...(userMessage?.trim() ? {userMessage: userMessage.trim()} : {})};
}

export function matchesSkillInvocationCommand(command: string, invocation: Pick<SkillInvocation, 'name' | 'userMessage'>): boolean {
  if (!command.startsWith('/skill:')) return false;
  const space = command.indexOf(' ');
  const name = space === -1 ? command.slice(7) : command.slice(7, space);
  const request = space === -1 ? '' : command.slice(space + 1).trim();
  return name === invocation.name && (request || undefined) === invocation.userMessage;
}
