"use client";

import { motion } from "framer-motion";
import { Diya } from "./Diya";

interface Props {
  message?: string;
  submessage?: string;
}

export function DiyaEmptyState({ message = "Nothing here yet", submessage = "Eve is waiting for your event details!" }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-4 py-10 text-center"
    >
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
      >
        <Diya size={100} moodOverride="wave" />
      </motion.div>
      <div>
        <p className="text-base font-bold text-[#374151]">{message}</p>
        <p className="text-sm text-[#66736A] mt-1 max-w-xs">{submessage}</p>
      </div>
    </motion.div>
  );
}
