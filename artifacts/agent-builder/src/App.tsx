import { useAgentStore } from "@/lib/store";
import { runBuilderTurn } from "@/lib/agent-logic";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { BlueprintPreview } from "@/components/BlueprintPreview";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

function App() {
  const store = useAgentStore();
  const agent = store.currentAgent;
  const hasStarted = !!agent && agent.messages.length > 0;

  const handleSend = (text: string) => {
    if (!agent) return;
    runBuilderTurn({
      userText: text,
      agent,
      updateAgent: store.updateAgent,
      patchBlueprint: store.patchBlueprint,
      addMessageTo: store.addMessageTo,
      appendToMessage: store.appendToMessage,
    });
  };

  return (
    <div className="h-screen w-full bg-background overflow-hidden text-foreground dark">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={16} minSize={12} maxSize={24}>
          <Sidebar onNewAgent={store.createNewAgent} />
        </ResizablePanel>
        <ResizableHandle />
        {hasStarted && agent ? (
          <>
            <ResizablePanel defaultSize={36} minSize={26} maxSize={55}>
              <ChatArea
                agent={agent}
                onSendMessage={handleSend}
                variant="compact"
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={48} minSize={30}>
              <BlueprintPreview
                agent={agent}
                onUpdateAgent={(updates) =>
                  store.updateAgent(agent.id, updates)
                }
              />
            </ResizablePanel>
          </>
        ) : (
          <ResizablePanel defaultSize={84}>
            <ChatArea
              agent={agent}
              onSendMessage={handleSend}
              variant="welcome"
            />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
