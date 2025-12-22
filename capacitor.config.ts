import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'Steller.Phone.NotesApp',
  appName: 'Stellar Notes',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  }
};

export default config;
