import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "@/components/theme-toggle"


export default function Dashboard() {
  return (
    <div className="w-full h-full items-center justify-center bg-card">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-lg">
        <Field orientation="horizontal">
          <Input type="search" placeholder="Stock Ticker" />
          <Button>View</Button>
        </Field>
      </div>
    </div>
  )
}


