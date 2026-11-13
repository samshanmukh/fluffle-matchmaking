import type { Ionicons } from '@expo/vector-icons';

type Icon = keyof typeof Ionicons.glyphMap;

export const ANY_TOPIC_ICON: Icon = 'sparkles-outline';

const ICONS: Record<string, Icon> = {
  politics: 'megaphone-outline',
  philosophy: 'bulb-outline',
  sports: 'football-outline',
  travel: 'airplane-outline',
  food: 'restaurant-outline',
  music: 'musical-notes-outline',
  movies: 'film-outline',
  technology: 'hardware-chip-outline',
};

export function topicIcon(topic: string | null): Icon {
  return (topic && ICONS[topic]) || ANY_TOPIC_ICON;
}

// Something to say first. With an agreed topic the starters are about it;
// without one they are easy openers that work with a stranger.
const STARTERS: Record<string, string[]> = {
  politics: [
    'What is one local issue you wish more people talked about?',
    'Has your mind ever changed on a political question? What changed it?',
    'If you could fix one thing in your city tomorrow, what would it be?',
  ],
  philosophy: [
    'Is it better to be kind or to be honest, when you can only be one?',
    'What is something you believed five years ago and no longer do?',
    'Would you want to know the future if you could not change it?',
  ],
  sports: [
    'Which sport do you love watching, and which do you love playing?',
    'What is the best match or game you have ever seen?',
    'Who was your first sporting hero?',
  ],
  travel: [
    'Where is the last place that surprised you?',
    'Do you plan every day of a trip, or figure it out when you arrive?',
    'What is a place you would go back to tomorrow?',
  ],
  food: [
    'What dish tastes like home to you?',
    'What is the best thing you have eaten this year?',
    'Is there a food you used to hate and now love?',
  ],
  music: [
    'What song have you had on repeat lately?',
    'What was the first concert you went to?',
    'Is there an album you know every word of?',
  ],
  movies: [
    'What film could you watch again and again?',
    'What is a movie everyone loves that you just do not get?',
    'Which film character would you most like to have dinner with?',
  ],
  technology: [
    'What piece of technology could you not give up?',
    'Is there an app you wish existed?',
    'What did you think the future would look like when you were a kid?',
  ],
};

const OPENERS = [
  'What has been the best part of your week so far?',
  'What is something you are looking forward to?',
  'Where did you grow up, and what was it like?',
  'What do you like doing when you have a free afternoon?',
];

/**
 * The starter both people see first is picked from the match id, so the two
 * phones show the same one. "Another idea" then steps through the rest.
 */
export function starter(topic: string | null, matchId: number, step = 0): string {
  const pool = (topic && STARTERS[topic]) || OPENERS;
  return pool[(matchId + step) % pool.length];
}
