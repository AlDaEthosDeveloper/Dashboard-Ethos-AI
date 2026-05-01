import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { askAI, approveDirectory, enableLearningMode, setOpenAIKey, teachAI } from "@/ai/agent";
import { isTauriRuntimeAvailable } from "@/ai/tools";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * Executes `AICopilotPanel`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const AICopilotPanel = () => {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("AI response will appear here.");
  const [isBusy, setIsBusy] = useState(false);

  const [learningMode, setLearningModeState] = useState(false);
  const [tauriAvailable] = useState(isTauriRuntimeAvailable());
  const [directoryPath, setDirectoryPath] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [learningStatus, setLearningStatus] = useState("No directory approved.");

  const canSubmitQuestion = useMemo(() => question.trim().length > 0 && !isBusy, [question, isBusy]);
  const canApproveDirectory = useMemo(() => directoryPath.trim().length > 0 && !isBusy, [directoryPath, isBusy]);

  const onSaveApiKey = () => {
    setOpenAIKey(apiKeyInput);
    setLearningStatus(apiKeyInput.trim() ? "OpenAI API key saved for this browser profile." : "OpenAI API key cleared.");
  };

  const onAskAI = async () => {
    if (!canSubmitQuestion) return;

    setIsBusy(true);
    try {
      const response = await askAI(question.trim());
      setAnswer(response || "No response.");
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : "Unknown AI error.");
    } finally {
      setIsBusy(false);
    }
  };

  const onToggleLearningMode = (enabled: boolean) => {
    setLearningModeState(enabled);
    if (enabled) {
      enableLearningMode(true);
      setLearningStatus("Learning mode enabled.");
    } else {
      enableLearningMode(false);
      setLearningStatus("Learning mode disabled for this session.");
    }
  };

  const onApproveDirectory = async () => {
    if (!canApproveDirectory) return;

    setIsBusy(true);
    try {
      await approveDirectory(directoryPath.trim());
      setLearningStatus(`Approved: ${directoryPath.trim()}`);
    } catch (error) {
      setLearningStatus(error instanceof Error ? error.message : "Failed to approve directory.");
    } finally {
      setIsBusy(false);
    }
  };

  const onTeachAI = async () => {
    if (!canApproveDirectory) return;

    setIsBusy(true);
    try {
      const result = await teachAI(directoryPath.trim());
      setLearningStatus(result);
    } catch (error) {
      setLearningStatus(error instanceof Error ? error.message : "Failed to teach AI.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Card className="fixed bottom-4 right-4 z-50 w-[420px] shadow-xl border-primary/20">
      <CardHeader className="space-y-2 pb-3">
        <CardTitle className="text-base">AI Copilot</CardTitle>
        <CardDescription>Ask about this screen or run app actions via AI tools.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder="Set OpenAI API key (optional UI override)"
            />
            <Button variant="outline" onClick={onSaveApiKey} disabled={isBusy}>
              Save Key
            </Button>
          </div>
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask AI about what is currently on screen..."
            className="min-h-[84px]"
          />
          <Button onClick={onAskAI} disabled={!canSubmitQuestion} className="w-full">
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Ask AI
          </Button>
        </div>

        <div className="rounded-md border p-3 text-sm text-muted-foreground whitespace-pre-wrap">{answer}</div>

        <div className="space-y-2 rounded-md border p-3">
          {!tauriAvailable ? (
            <p className="text-xs text-amber-600">Folder approval/teaching works only in the Tauri desktop runtime.</p>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Learning Mode</span>
            <Switch checked={learningMode} onCheckedChange={onToggleLearningMode} />
          </div>

          <Input
            value={directoryPath}
            onChange={(event) => setDirectoryPath(event.target.value)}
            placeholder="/path/to/database-or-data-folder"
          />

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={onApproveDirectory} disabled={!canApproveDirectory || !learningMode || !tauriAvailable}>
              Approve Folder
            </Button>
            <Button onClick={onTeachAI} disabled={!canApproveDirectory || !learningMode || !tauriAvailable}>
              Teach AI
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{learningStatus}</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default AICopilotPanel;
