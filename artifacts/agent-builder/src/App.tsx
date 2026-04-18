import { useState } from "react";
import { useAgentStore } from "@/lib/store";
import { runBuilderTurn, deployFromBlueprint } from "@/lib/agent-logic";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { BlueprintPreview } from "@/components/BlueprintPreview";
import { DeployedAgentDashboard } from "@/components/DeployedAgent";
import { ConnectionsScreen } from "@/components/ConnectionsScreen";
import { Button } from "@/components/ui/button";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

type ActiveView = "agent" | "connections";

function App() {
  const store = useAgentStore();
  const agent = store.currentAgent;
  const hasStarted = !!agent && agent.phase !== "welcome";
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("agent");
  const [connectionsHighlight, setConnectionsHighlight] = useState<
    string | null
  >(null);

  const handleSend = (text: string) => {
    if (!agent) return;
    void runBuilderTurn({
      agent,
      userText: text,
      updateAgent: store.updateAgent,
      addMessageTo: store.addMessageTo,
      appendToMessage: store.appendToMessage,
      addActivityTo: store.addActivityTo,
      patchBlueprint: store.patchBlueprint,
    });
  };

  const handleDeploy = () => {
    if (!agent) return;
    void deployFromBlueprint({
      agent,
      updateAgent: store.updateAgent,
      addMessageTo: store.addMessageTo,
    });
  };

  const handleClose = () => {
    if (!agent) return;
    store.updateAgent(agent.id, { phase: "welcome" });
  };

  const handleNewAgent = () => {
    store.createNewAgent();
    setActiveView("agent");
  };

  const handleOpenConnections = (highlightId?: string) => {
    setConnectionsHighlight(highlightId ?? null);
    setActiveView("connections");
  };

  return (
    <div className="h-screen w-full bg-background overflow-hidden text-foreground relative">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setSidebarHidden((v) => !v)}
        className="absolute top-4 left-3 z-50 h-7 w-7 text-foreground/60 hover:text-foreground hover:bg-transparent"
        title={sidebarHidden ? "Show chats" : "Hide chats"}
      >
        {sidebarHidden ? (
          <PanelLeftOpen className="h-4 w-4" />
        ) : (
          <PanelLeftClose className="h-4 w-4" />
        )}
      </Button>

      <ResizablePanelGroup direction="horizontal" className="h-full w-full">
        {!sidebarHidden && (
          <>
            <ResizablePanel defaultSize={16} minSize={12} maxSize={24}>
              <Sidebar
                onNewAgent={handleNewAgent}
                onOpenConnections={() => handleOpenConnections()}
                activeView={activeView}
              />
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}
        {activeView === "connections" ? (
          <ResizablePanel defaultSize={84}>
            <ConnectionsScreen
              highlightId={connectionsHighlight}
              onHighlightConsumed={() => setConnectionsHighlight(null)}
            />
          </ResizablePanel>
        ) : hasStarted && agent ? (
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
              {agent.phase === "deployed" && agent.deploymentId ? (
                <DeployedAgentDashboard
                  deploymentId={agent.deploymentId}
                  onDisconnect={handleClose}
                  onOpenConnections={handleOpenConnections}
                />
              ) : (
                <BlueprintPreview
                  blueprint={agent.blueprint}
                  deploying={agent.status === "Deploying"}
                  generating={agent.generating}
                  onDeploy={handleDeploy}
                />
              )}
            </ResizablePanel>
          </>
        ) : (
          <ResizablePanel defaultSize={84}>
            <ChatArea
              agent={agent}
              onSendMessage={handleSend}
              variant={hasStarted ? "compact" : "welcome"}
            />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
