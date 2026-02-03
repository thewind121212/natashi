// Command registry - exports all slash commands

import * as play from './play';
import * as stop from './stop';

export const commands = [play, stop];
