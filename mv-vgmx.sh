#!/usr/bin/env bash

# Declare variable for inputpath and outputpath, remove quotation marks
inPath=$(sed -e 's/^"//' -e 's/"$//' <<<"$1")
cd $inPath || return
mkdir -p $inPath/128p
ls | grep '\.vgmx$' | xargs -I '{}' mv {} $inPath/128p
sed -i -e 's/^data/128p\/data/g' $inPath/128p.m3u8
