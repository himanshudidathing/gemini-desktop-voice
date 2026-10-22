import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Monitor, Globe, AudioLines, Sparkles } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Operator } from '@main/store/types';
import { useSession } from '@renderer/hooks/useSession';
import {
  checkVLMSettings,
  LocalSettingsDialog,
} from '@renderer/components/Settings/local';
import { DragArea } from '@renderer/components/Common/drag';

export default function Home() {
  const navigate = useNavigate();
  const { createSession } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [operator, setOperator] = useState(Operator.LocalComputer);
  async function open(value: Operator) {
    setOperator(value);
    if (!(await checkVLMSettings())) {
      setSettingsOpen(true);
      return;
    }
    const session = await createSession('New Gemini session', {
      operator: value,
    });
    navigate('/local', {
      state: { operator: value, sessionId: session?.id, from: 'home' },
    });
  }
  return (
    <div className="h-full overflow-auto bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <DragArea />
      <main className="mx-auto max-w-4xl px-10 py-14">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm text-blue-700">
          <Sparkles size={16} /> Powered only by Google Gemini
        </div>
        <h1 className="text-5xl font-semibold tracking-tight text-slate-900">
          Say it. Gemini gets to work.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600">
          A voice assistant that can see your screen, use your computer, and
          talk back. Type a task, upload audio, or enable voice and say
          “Gemini.”
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {[
            {
              value: Operator.LocalComputer,
              icon: Monitor,
              title: 'Your computer',
              text: 'Work across desktop apps with screenshot-based actions.',
            },
            {
              value: Operator.LocalBrowser,
              icon: Globe,
              title: 'Your browser',
              text: 'Navigate websites and complete tasks in local Chrome.',
            },
          ].map((item) => (
            <div
              key={item.value}
              className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm"
            >
              <item.icon className="mb-6 text-blue-600" size={30} />
              <h2 className="text-xl font-semibold">{item.title}</h2>
              <p className="mt-2 min-h-12 text-slate-500">{item.text}</p>
              <Button
                className="mt-6 w-full"
                onClick={() => void open(item.value)}
              >
                Open {item.title.toLowerCase()}
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-7 flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-slate-600">
          <AudioLines className="shrink-0 text-blue-600" />
          <p>
            One Google AI Studio API key connects the Gemini task model and
            Gemini Live voice model. Free-tier use is subject to Google’s model
            access and quotas. Enable the microphone inside a session; turn
            voice off at any time.
          </p>
        </div>
        <LocalSettingsDialog
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSubmit={() => {
            setSettingsOpen(false);
            void open(operator);
          }}
        />
      </main>
    </div>
  );
}
