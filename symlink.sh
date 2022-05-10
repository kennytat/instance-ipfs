#!/usr/bin/env bash

# Declare variable for inputpath and outputpath, remove quotation marks
# $1 inpath, $2 filetype $3 keyHash
inPath=$(sed -e 's/^"//' -e 's/"$//' <<<"$1")
outPath=$(sed -e 's/^"//' -e 's/"$//' <<<"$2")
# cd $inPath || return
echo $inPath $outPath
mkdir -p $outPath
cd $inPath
find . -type f \( ! -iname "*.vgmk" \) | while read -r item; do
	mkdir -p "$(dirname "${outPath}/${item}")"
	ln -s "${inPath}/${item}" "${outPath}/${item}"
	echo $item
done
