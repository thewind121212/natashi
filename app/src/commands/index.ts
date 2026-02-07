// Command registry - exports all slash commands

import * as play from './play';
import * as stop from './stop';
import * as pause from './pause';
import * as resume from './resume';
import * as next from './next';
import * as jump from './jump';
import * as queue from './queue';
import * as nowplaying from './nowplaying';
import * as previous from './previous';
import * as seek from './seek';
import * as status from './status';
import * as help from './help';

export const commands = [
  play,
  stop,
  pause,
  resume,
  next,
  jump,
  queue,
  nowplaying,
  previous,
  seek,
  status,
  help,
];
