import { useAgentStore } from "@/lib/store";
import { simulateAIResponse } from "@/lib/agent-logic";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { RightPanel } from "@/components/RightPanel";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

function App() {
  const store = useAgentStore();

  return (
    <div className="h-screen w-full bg-background overflow-hidden text-foreground dark">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={18} minSize={14} maxSize={30}>
          <Sidebar
            agents={store.agents}
            currentAgentId={store.currentAgent?.id || null}
            onNewAgent={store.createNewAgent}
            onSwitchAgent={store.switchAgent}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={48} minSize={30}>
          <div className="flex h-full flex-col border-r border-border min-w-0 relative">
            <ChatArea
              agent={store.currentAgent}
              onSendMessage={(text) => {
                if (store.currentAgent) {
                  simulateAIResponse(
                    text,
                    store.currentAgent,
                    store.updateAgent,
                    store.addMessageTo,
                  );
                }
              }}
              tools={
                store.currentAgent?.tools || {
                  stripe: false,
                  jira: false,
                  slack: false,
                }
              }
              onUpdateTools={(tools) => store.updateCurrentAgent({ tools })}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={34} minSize={22} maxSize={55}>
          <div className="h-full bg-card flex flex-col">
            <RightPanel agent={store.currentAgent} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
